import { fromBase64, toBase64 } from './crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const KEY = /^[A-Za-z0-9_-]{43}$/

function encodeKey(key: Uint8Array): string {
  return toBase64(key).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decodeKey(value: string): Uint8Array | null {
  try {
    const bytes = fromBase64(value.replaceAll('-', '+').replaceAll('_', '/') + '=')
    return bytes.length === 32 ? bytes : null
  } catch {
    return null
  }
}

export function buildLink(base: string, id: string, key: Uint8Array, hasPassword: boolean): string {
  return `${base}#${id}.${encodeKey(key)}${hasPassword ? '.p' : ''}`
}

export function parseFragment(
  hash: string,
): { id: string; key: Uint8Array; hasPassword: boolean } | null {
  const trimmed = hash.trim()
  const parts = (trimmed.startsWith('#') ? trimmed.slice(1) : trimmed).split('.')
  if (parts.length < 2 || parts.length > 3) return null
  const [id = '', keyPart = '', suffix] = parts
  if (!UUID.test(id) || !KEY.test(keyPart)) return null
  if (suffix !== undefined && suffix !== 'p') return null
  const key = decodeKey(keyPart)
  if (!key || encodeKey(key) !== keyPart) return null
  return { id, key, hasPassword: suffix === 'p' }
}
