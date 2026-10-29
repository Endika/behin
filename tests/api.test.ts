import { describe, expect, it } from 'vitest'
import { CapacityError, NetworkError, RequestError, createHttpApi, type TtlSeconds } from '@/api'
import { sealNote, toBase64, unlock } from '@/crypto'
import { createFakeApi } from './fake-api'

const ID = '123e4567-e89b-42d3-a456-426614174000'
const sealed = {
  ciphertext: toBase64(new Uint8Array(20).fill(1)),
  iv: toBase64(new Uint8Array(12).fill(2)),
  authHash: toBase64(new Uint8Array(32).fill(3)),
  gateHash: toBase64(new Uint8Array(32).fill(4)),
}

type Call = { url: string; init: RequestInit }

function sent(calls: Call[]): Call {
  const call = calls[0]
  if (!call) throw new Error('no request was sent')
  return call
}

function recorder(respond: () => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return respond()
  }) as typeof fetch
  return { calls, fetchFn }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('http api', () => {
  it('create posts the exact request and returns the id', async () => {
    const { calls, fetchFn } = recorder(() => json(ID))
    const api = createHttpApi('https://x.supabase.co/', 'anon', fetchFn)
    expect(await api.create(sealed, 3600)).toBe(ID)
    expect(calls).toHaveLength(1)
    expect(sent(calls).url).toBe('https://x.supabase.co/rest/v1/rpc/create_note')
    expect(sent(calls).init.method).toBe('POST')
    expect(sent(calls).init.headers).toEqual({
      apikey: 'anon',
      Authorization: 'Bearer anon',
      'Content-Type': 'application/json',
      'Content-Profile': 'behin',
      'Accept-Profile': 'behin',
    })
    expect(JSON.parse(sent(calls).init.body as string)).toEqual({
      p_ciphertext: sealed.ciphertext,
      p_iv: sealed.iv,
      p_auth_hash: sealed.authHash,
      p_gate_hash: sealed.gateHash,
      p_ttl_seconds: 3600,
    })
    expect(sent(calls).init.cache).toBe('no-store')
    expect(sent(calls).init.referrerPolicy).toBe('no-referrer')
    expect(sent(calls).init.credentials).toBe('omit')
  })

  it('open posts the exact request and passes results through', async () => {
    const results = [
      { status: 'ok', ciphertext: 'c', iv: 'i' },
      { status: 'wrong', remaining: 3 },
      { status: 'gone' },
    ]
    for (const result of results) {
      const { calls, fetchFn } = recorder(() => json(result))
      const api = createHttpApi('https://x.supabase.co', 'anon', fetchFn)
      expect(await api.open(ID, 'GATE', 'AUTH')).toEqual(result)
      expect(sent(calls).url).toBe('https://x.supabase.co/rest/v1/rpc/open_note')
      expect(JSON.parse(sent(calls).init.body as string)).toEqual({
        p_id: ID,
        p_gate: 'GATE',
        p_auth: 'AUTH',
      })
    }
  })

  it('maps failures to typed errors', async () => {
    const make = (respond: () => Response | Promise<Response>) =>
      createHttpApi('https://x', 'k', recorder(respond).fetchFn)
    const boom = () => Promise.reject(new TypeError('offline'))
    await expect(make(boom).open(ID, 'g', 'a')).rejects.toBeInstanceOf(NetworkError)
    await expect(make(() => json({}, 503)).open(ID, 'g', 'a')).rejects.toBeInstanceOf(NetworkError)
    await expect(
      make(() => new Response('<html>', { status: 200 })).open(ID, 'g', 'a'),
    ).rejects.toBeInstanceOf(NetworkError)
    await expect(
      make(() => json({ message: 'capacity reached' }, 400)).create(sealed, 600),
    ).rejects.toBeInstanceOf(CapacityError)
    const rejected = make(() => json({ message: 'invalid p_ttl_seconds' }, 400)).create(sealed, 600)
    await expect(rejected).rejects.toBeInstanceOf(RequestError)
    await expect(rejected).rejects.toMatchObject({ status: 400 })
  })

  it('rejects malformed success bodies', async () => {
    const make = (body: unknown) =>
      createHttpApi('https://x', 'k', recorder(() => json(body)).fetchFn)
    await expect(make('not-a-uuid').create(sealed, 600)).rejects.toBeInstanceOf(NetworkError)
    await expect(make({ status: 'maybe' }).open(ID, 'g', 'a')).rejects.toBeInstanceOf(NetworkError)
    await expect(make({ status: 'wrong' }).open(ID, 'g', 'a')).rejects.toBeInstanceOf(NetworkError)
    await expect(make({ status: 'ok', iv: 'i' }).open(ID, 'g', 'a')).rejects.toBeInstanceOf(
      NetworkError,
    )
    await expect(make({ status: 'ok', ciphertext: 'c' }).open(ID, 'g', 'a')).rejects.toBeInstanceOf(
      NetworkError,
    )
    const html = createHttpApi(
      'https://x',
      'k',
      recorder(() => new Response('<html>', { status: 400 })).fetchFn,
    )
    await expect(html.open(ID, 'g', 'a')).rejects.toBeInstanceOf(NetworkError)
  })

  it('error messages do not leak request data', async () => {
    const api = createHttpApi('https://x', 'secret-key', recorder(() => json({}, 400)).fetchFn)
    const error = await api.open(ID, 'SECRETGATE', 'SECRETAUTH').then(
      () => new Error('expected rejection'),
      (e: unknown) => e as Error,
    )
    expect(error.message).not.toContain('SECRETAUTH')
    expect(error.message).not.toContain('SECRETGATE')
    expect(error.message).not.toContain('secret-key')
  })
})

describe('fake api', () => {
  const auth = toBase64(new Uint8Array(32).fill(7))
  const gate = toBase64(new Uint8Array(32).fill(8))
  async function hashOf(fill: number) {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(32).fill(fill))
    return toBase64(new Uint8Array(digest))
  }
  async function stored(api: ReturnType<typeof createFakeApi>, ttl: TtlSeconds = 3600) {
    return api.create({ ...sealed, authHash: await hashOf(7), gateHash: await hashOf(8) }, ttl)
  }

  it('returns the note once, then gone', async () => {
    const api = createFakeApi()
    const id = await stored(api)
    expect(await api.open(id, gate, auth)).toEqual({
      status: 'ok',
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
    })
    expect(await api.open(id, gate, auth)).toEqual({ status: 'gone' })
    expect(api.rows().size).toBe(0)
  })

  it('counts down wrong attempts and destroys the note on the fifth', async () => {
    const api = createFakeApi()
    const id = await stored(api)
    const bad = toBase64(new Uint8Array(32))
    for (const remaining of [4, 3, 2, 1, 0]) {
      expect(await api.open(id, gate, bad)).toEqual({ status: 'wrong', remaining })
    }
    expect(await api.open(id, gate, auth)).toEqual({ status: 'gone' })
  })

  it('treats malformed auth as a wrong attempt', async () => {
    const api = createFakeApi()
    const id = await stored(api)
    expect(await api.open(id, gate, '!!!')).toEqual({ status: 'wrong', remaining: 4 })
  })

  it('a wrong gate is gone and never counts as an attempt', async () => {
    const api = createFakeApi()
    const id = await stored(api)
    const badGate = toBase64(new Uint8Array(32))
    for (let i = 0; i < 10; i++) {
      expect(await api.open(id, badGate, auth)).toEqual({ status: 'gone' })
      expect(await api.open(id, '!!!', auth)).toEqual({ status: 'gone' })
    }
    expect([...api.rows().values()][0]?.attempts).toBe(0)
    expect((await api.open(id, gate, auth)).status).toBe('ok')
  })

  it('rejects a gate hash that is not 32 bytes', async () => {
    const api = createFakeApi()
    await expect(
      api.create({ ...sealed, gateHash: toBase64(new Uint8Array(31)) }, 600),
    ).rejects.toThrow('p_gate_hash')
  })

  it('wrong then right opens the note', async () => {
    const api = createFakeApi()
    const id = await stored(api)
    await api.open(id, gate, toBase64(new Uint8Array(32)))
    expect((await api.open(id, gate, auth)).status).toBe('ok')
  })

  it('expires notes', async () => {
    let time = 1_000_000
    const api = createFakeApi({ now: () => time })
    const id = await stored(api, 600)
    time += 600 * 1000
    expect(await api.open(id, gate, auth)).toEqual({ status: 'gone' })
    expect(api.rows().size).toBe(0)
  })

  it('rejects an invalid ttl and stores only the allowed fields', async () => {
    const api = createFakeApi()
    await expect(api.create(sealed, 5 as TtlSeconds)).rejects.toThrow('invalid p_ttl_seconds')
    await stored(api)
    const row = [...api.rows().values()][0] ?? {}
    expect(Object.keys(row).sort()).toEqual(
      ['attempts', 'authHash', 'ciphertext', 'expiresAt', 'gateHash', 'iv'].sort(),
    )
  })

  it('rejects a non-uuid id like the uuid cast does', async () => {
    const api = createFakeApi()
    await expect(api.open('nope', gate, auth)).rejects.toBeInstanceOf(RequestError)
  })

  it('failNext fails exactly one call', async () => {
    const api = createFakeApi()
    api.failNext(new NetworkError())
    await expect(api.create(sealed, 600)).rejects.toBeInstanceOf(NetworkError)
    expect(await api.create(sealed, 600)).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('round-trips a real sealed note', async () => {
    const api = createFakeApi()
    const { key, sealed: note } = await sealNote('mensaje secreto', 'correct-horse-battery')
    const id = await api.create(note, 600)
    const stored = JSON.stringify([...api.rows().values()])
    expect(stored).not.toContain('mensaje secreto')
    expect(stored).not.toContain('correct-horse-battery')
    const unlocked = await unlock(key, 'correct-horse-battery')
    const result = await api.open(id, unlocked.gate, unlocked.auth)
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(await unlocked.decrypt(result.ciphertext, result.iv)).toBe('mensaje secreto')
  })
})
