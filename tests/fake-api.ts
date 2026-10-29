import { RequestError, type NotesApi, type OpenResult } from '@/api'
import { fromBase64, toBase64 } from '@/crypto'

export type FakeRow = {
  ciphertext: string
  iv: string
  authHash: string
  gateHash: string
  attempts: number
  expiresAt: number
}

export type FakeApi = NotesApi & {
  rows(): ReadonlyMap<string, Readonly<FakeRow>>
  failNext(error: Error): void
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TTLS = [600, 3600, 86400, 604800]
const MAX_ATTEMPTS = 5

function checkBase64(name: string, value: string, ok: (length: number) => boolean): void {
  let bytes: Uint8Array
  try {
    bytes = fromBase64(value)
  } catch {
    throw new Error(`invalid ${name}: not base64`)
  }
  if (!ok(bytes.length)) throw new Error(`invalid ${name}: size out of range`)
}

async function sha256Base64(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return toBase64(new Uint8Array(digest))
}

export function createFakeApi(options: { now?: () => number } = {}): FakeApi {
  const now = options.now ?? Date.now
  const notes = new Map<string, FakeRow>()
  let pendingFailure: Error | undefined

  function takeFailure(): void {
    if (!pendingFailure) return
    const error = pendingFailure
    pendingFailure = undefined
    throw error
  }

  return {
    rows: () => notes,
    failNext(error) {
      pendingFailure = error
    },
    async create(sealed, ttlSeconds) {
      takeFailure()
      if (!TTLS.includes(ttlSeconds)) throw new Error('invalid p_ttl_seconds')
      checkBase64('p_ciphertext', sealed.ciphertext, (n) => n >= 17 && n <= 10016)
      checkBase64('p_iv', sealed.iv, (n) => n === 12)
      checkBase64('p_auth_hash', sealed.authHash, (n) => n === 32)
      checkBase64('p_gate_hash', sealed.gateHash, (n) => n === 32)
      const id = crypto.randomUUID()
      notes.set(id, {
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authHash: sealed.authHash,
        gateHash: sealed.gateHash,
        attempts: 0,
        expiresAt: now() + ttlSeconds * 1000,
      })
      return id
    },
    async open(id, gate, auth): Promise<OpenResult> {
      takeFailure()
      if (!UUID.test(id)) throw new RequestError(400)
      const gateHash = await Promise.resolve()
        .then(() => sha256Base64(fromBase64(gate)))
        .catch(() => null)
      const hash = await Promise.resolve()
        .then(() => sha256Base64(fromBase64(auth)))
        .catch(() => null)
      const row = notes.get(id)
      if (!row) return { status: 'gone' }
      if (row.expiresAt <= now()) {
        notes.delete(id)
        return { status: 'gone' }
      }
      if (gateHash !== row.gateHash) return { status: 'gone' }
      if (hash === row.authHash) {
        notes.delete(id)
        return { status: 'ok', ciphertext: row.ciphertext, iv: row.iv }
      }
      row.attempts += 1
      const remaining = Math.max(0, MAX_ATTEMPTS - row.attempts)
      if (remaining === 0) notes.delete(id)
      return { status: 'wrong', remaining }
    },
  }
}
