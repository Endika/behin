export const MAX_NOTE_BYTES = 10_000

const PBKDF2_ITERATIONS = 600_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type SealedNote = { ciphertext: string; iv: string; authHash: string; gateHash: string }

export class DecryptError extends Error {
  constructor(options?: ErrorOptions) {
    super('Could not decrypt the note', options)
    this.name = 'DecryptError'
  }
}

export function utf8Bytes(text: string): number {
  return encoder.encode(text).length
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new TypeError('Invalid base64')
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  if (toBase64(bytes) !== value) throw new TypeError('Non-canonical base64')
  return bytes
}

async function hkdf(ikm: Uint8Array, info: string, bytes: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode(info),
    },
    base,
    bytes * 8,
  )
  return new Uint8Array(bits)
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    base,
    256,
  )
  return new Uint8Array(bits)
}

async function deriveIkm(key: Uint8Array, password?: string): Promise<Uint8Array> {
  if (!password) return key
  // The salt comes from the key so the server never stores or sees it.
  const salt = await hkdf(key, 'behin/v1/salt', 16)
  const pw = await pbkdf2(password, salt)
  const ikm = new Uint8Array(key.length + pw.length)
  ikm.set(key)
  ikm.set(pw, key.length)
  return ikm
}

async function deriveEncKey(ikm: Uint8Array): Promise<CryptoKey> {
  const raw = await hkdf(ikm, 'behin/v1/enc', 32)
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

async function deriveAuthBytes(ikm: Uint8Array): Promise<Uint8Array> {
  return hkdf(ikm, 'behin/v1/auth', 32)
}

// The gate depends on the link key alone, so a password never reaches it and
// someone holding only the id cannot produce it.
async function deriveGate(key: Uint8Array): Promise<Uint8Array> {
  return hkdf(key, 'behin/v1/gate', 32)
}

export async function sealNote(
  text: string,
  password?: string,
): Promise<{ key: Uint8Array; sealed: SealedNote }> {
  if (text.length === 0) throw new RangeError('The note is empty')
  const plaintext = encoder.encode(text)
  if (plaintext.length > MAX_NOTE_BYTES) {
    throw new RangeError(`The note exceeds ${MAX_NOTE_BYTES} bytes`)
  }
  if (text.includes('\0')) throw new RangeError('The note contains U+0000')
  // Every note is zero-padded to the same size so the ciphertext says nothing
  // about its length; refusing U+0000 keeps the padding unambiguous.
  const padded = new Uint8Array(MAX_NOTE_BYTES)
  padded.set(plaintext)
  const key = crypto.getRandomValues(new Uint8Array(32))
  const ikm = await deriveIkm(key, password)
  const encKey = await deriveEncKey(ikm)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, encKey, padded),
  )
  const authToken = await deriveAuthBytes(ikm)
  const authHash = new Uint8Array(await crypto.subtle.digest('SHA-256', authToken as BufferSource))
  const gate = await deriveGate(key)
  const gateHash = new Uint8Array(await crypto.subtle.digest('SHA-256', gate as BufferSource))
  return {
    key,
    sealed: {
      ciphertext: toBase64(ciphertext),
      iv: toBase64(iv),
      authHash: toBase64(authHash),
      gateHash: toBase64(gateHash),
    },
  }
}

export interface Unlocked {
  gate: string
  auth: string
  decrypt(ciphertext: string, iv: string): Promise<string>
}

export async function unlock(key: Uint8Array, password?: string): Promise<Unlocked> {
  const ikm = await deriveIkm(key, password)
  const [encKey, authBytes, gateBytes] = await Promise.all([
    deriveEncKey(ikm),
    deriveAuthBytes(ikm),
    deriveGate(key),
  ])
  return {
    gate: toBase64(gateBytes),
    auth: toBase64(authBytes),
    async decrypt(ciphertext, iv) {
      try {
        const ivBytes = fromBase64(iv)
        if (ivBytes.length !== 12) throw new TypeError('Invalid iv length')
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: ivBytes as BufferSource },
          encKey,
          fromBase64(ciphertext) as BufferSource,
        )
        const bytes = new Uint8Array(plaintext)
        let end = bytes.length
        while (end > 0 && bytes[end - 1] === 0) end--
        return decoder.decode(bytes.subarray(0, end))
      } catch (error) {
        throw new DecryptError({ cause: error })
      }
    },
  }
}
