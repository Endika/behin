import type { SealedNote } from './crypto'

export type TtlSeconds = 600 | 3600 | 86400 | 604800

export type OpenResult =
  | { status: 'ok'; ciphertext: string; iv: string }
  | { status: 'wrong'; remaining: number }
  | { status: 'gone' }

export interface NotesApi {
  create(sealed: SealedNote, ttlSeconds: TtlSeconds): Promise<string>
  open(id: string, auth: string): Promise<OpenResult>
}

export class NetworkError extends Error {
  constructor(options?: ErrorOptions) {
    super('Network or server error', options)
    this.name = 'NetworkError'
  }
}

export class CapacityError extends Error {
  constructor() {
    super('The service is at capacity')
    this.name = 'CapacityError'
  }
}

export class RequestError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Request rejected (${status})`)
    this.name = 'RequestError'
    this.status = status
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createHttpApi(
  url: string,
  anonKey: string,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): NotesApi {
  const base = url.endsWith('/') ? url.slice(0, -1) : url

  async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response
    try {
      response = await fetchFn(`${base}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          'Content-Profile': 'behin',
          'Accept-Profile': 'behin',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
      })
    } catch (cause) {
      throw new NetworkError({ cause })
    }
    if (response.status >= 500) throw new NetworkError()
    let data: unknown
    try {
      data = await response.json()
    } catch (cause) {
      throw new NetworkError({ cause })
    }
    if (response.status >= 400) {
      if (isRecord(data) && data.message === 'capacity reached') throw new CapacityError()
      throw new RequestError(response.status)
    }
    return data
  }

  return {
    async create(sealed, ttlSeconds) {
      const data = await rpc('create_note', {
        p_ciphertext: sealed.ciphertext,
        p_iv: sealed.iv,
        p_auth_hash: sealed.authHash,
        p_ttl_seconds: ttlSeconds,
      })
      if (typeof data !== 'string' || !UUID.test(data)) throw new NetworkError()
      return data
    },
    async open(id, auth) {
      const data = await rpc('open_note', { p_id: id, p_auth: auth })
      if (!isRecord(data)) throw new NetworkError()
      if (data.status === 'gone') return { status: 'gone' }
      if (data.status === 'wrong' && typeof data.remaining === 'number') {
        return { status: 'wrong', remaining: data.remaining }
      }
      if (
        data.status === 'ok' &&
        typeof data.ciphertext === 'string' &&
        typeof data.iv === 'string'
      ) {
        return { status: 'ok', ciphertext: data.ciphertext, iv: data.iv }
      }
      throw new NetworkError()
    },
  }
}
