import { describe, expect, it } from 'vitest'
import {
  DecryptError,
  MAX_NOTE_BYTES,
  deriveAuth,
  fromBase64,
  openNote,
  sealNote,
  toBase64,
  utf8Bytes,
} from '@/crypto'

async function sha256Base64(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return toBase64(new Uint8Array(digest))
}

describe('crypto', () => {
  it('roundtrip without password', async () => {
    const { key, sealed } = await sealNote('hola behin')
    expect(key).toHaveLength(32)
    expect(await openNote(key, undefined, sealed.ciphertext, sealed.iv)).toBe('hola behin')
  })

  it('roundtrip with password', async () => {
    const { key, sealed } = await sealNote('secreto', 'correct horse')
    expect(await openNote(key, 'correct horse', sealed.ciphertext, sealed.iv)).toBe('secreto')
  })

  it('treats an empty password the same as no password', async () => {
    const { key, sealed } = await sealNote('sin clave', '')
    expect(await openNote(key, undefined, sealed.ciphertext, sealed.iv)).toBe('sin clave')
    expect(await deriveAuth(key, '')).toBe(await deriveAuth(key))
  })

  it('wrong password throws', async () => {
    const { key, sealed } = await sealNote('secreto', 'right')
    await expect(openNote(key, 'wrong', sealed.ciphertext, sealed.iv)).rejects.toBeInstanceOf(
      DecryptError,
    )
    await expect(openNote(key, undefined, sealed.ciphertext, sealed.iv)).rejects.toBeInstanceOf(
      DecryptError,
    )
  })

  it('wrong key throws', async () => {
    const { sealed } = await sealNote('secreto')
    const other = crypto.getRandomValues(new Uint8Array(32))
    await expect(openNote(other, undefined, sealed.ciphertext, sealed.iv)).rejects.toBeInstanceOf(
      DecryptError,
    )
  })

  it('tampered ciphertext throws', async () => {
    const { key, sealed } = await sealNote('secreto')
    const bytes = fromBase64(sealed.ciphertext)
    bytes[0] = (bytes[0] ?? 0) ^ 1
    await expect(openNote(key, undefined, toBase64(bytes), sealed.iv)).rejects.toBeInstanceOf(
      DecryptError,
    )
  })

  it('authHash equals sha256 of deriveAuth', async () => {
    const { key, sealed } = await sealNote('hola', 'pw')
    const auth = await deriveAuth(key, 'pw')
    expect(sealed.authHash).toBe(await sha256Base64(fromBase64(auth)))
    expect(fromBase64(auth)).toHaveLength(32)
  })

  it('different password gives different auth', async () => {
    const { key } = await sealNote('hola')
    const a = await deriveAuth(key, 'one')
    const b = await deriveAuth(key, 'two')
    expect(a).not.toBe(b)
    expect(a).not.toBe(await deriveAuth(key))
  })

  it('password NFC and NFD forms open the same note', async () => {
    const nfc = 'café'
    const nfd = 'café'
    expect(nfc).not.toBe(nfd)
    const { key, sealed } = await sealNote('nota', nfc)
    expect(await openNote(key, nfd, sealed.ciphertext, sealed.iv)).toBe('nota')
    expect(await deriveAuth(key, nfd)).toBe(await deriveAuth(key, nfc))
  })

  it('utf8Bytes counts 10000 bytes of emoji as over the limit', () => {
    const emoji = '\u{1F600}'.repeat(MAX_NOTE_BYTES)
    expect(emoji.length).toBe(MAX_NOTE_BYTES * 2)
    expect(utf8Bytes(emoji)).toBe(MAX_NOTE_BYTES * 4)
    expect(utf8Bytes(emoji)).toBeGreaterThan(MAX_NOTE_BYTES)
  })

  it('sealNote rejects empty and oversized text', async () => {
    await expect(sealNote('')).rejects.toBeInstanceOf(RangeError)
    await expect(sealNote('a'.repeat(MAX_NOTE_BYTES + 1))).rejects.toBeInstanceOf(RangeError)
    await expect(sealNote('a'.repeat(MAX_NOTE_BYTES))).resolves.toBeDefined()
    await expect(sealNote('\u{1F600}'.repeat(2501))).rejects.toBeInstanceOf(RangeError)
  })

  it('emits standard base64 with a 12-byte iv and fresh randomness', async () => {
    const a = await sealNote('mismo texto')
    const b = await sealNote('mismo texto')
    expect(fromBase64(a.sealed.iv)).toHaveLength(12)
    expect(a.sealed.ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(a.sealed.ciphertext).not.toBe(b.sealed.ciphertext)
    expect(a.sealed.authHash).not.toBe(b.sealed.authHash)
  })
})
