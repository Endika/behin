import { describe, expect, it } from 'vitest'
import {
  DecryptError,
  MAX_NOTE_BYTES,
  fromBase64,
  sealNote,
  toBase64,
  unlock,
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
    expect(await (await unlock(key, undefined)).decrypt(sealed.ciphertext, sealed.iv)).toBe(
      'hola behin',
    )
  })

  it('roundtrip with password', async () => {
    const { key, sealed } = await sealNote('secreto', 'correct horse')
    expect(await (await unlock(key, 'correct horse')).decrypt(sealed.ciphertext, sealed.iv)).toBe(
      'secreto',
    )
  })

  it('treats an empty password the same as no password', async () => {
    const { key, sealed } = await sealNote('sin clave', '')
    expect(await (await unlock(key, undefined)).decrypt(sealed.ciphertext, sealed.iv)).toBe(
      'sin clave',
    )
    expect((await unlock(key, '')).auth).toBe((await unlock(key)).auth)
  })

  it('wrong password throws', async () => {
    const { key, sealed } = await sealNote('secreto', 'right')
    await expect(
      (await unlock(key, 'wrong')).decrypt(sealed.ciphertext, sealed.iv),
    ).rejects.toBeInstanceOf(DecryptError)
    await expect(
      (await unlock(key, undefined)).decrypt(sealed.ciphertext, sealed.iv),
    ).rejects.toBeInstanceOf(DecryptError)
  })

  it('wrong key throws', async () => {
    const { sealed } = await sealNote('secreto')
    const other = crypto.getRandomValues(new Uint8Array(32))
    await expect(
      (await unlock(other, undefined)).decrypt(sealed.ciphertext, sealed.iv),
    ).rejects.toBeInstanceOf(DecryptError)
  })

  it('tampered ciphertext throws', async () => {
    const { key, sealed } = await sealNote('secreto')
    const bytes = fromBase64(sealed.ciphertext)
    bytes[0] = (bytes[0] ?? 0) ^ 1
    await expect(
      (await unlock(key, undefined)).decrypt(toBase64(bytes), sealed.iv),
    ).rejects.toBeInstanceOf(DecryptError)
  })

  it('flipping one iv byte throws', async () => {
    const { key, sealed } = await sealNote('secreto')
    const iv = fromBase64(sealed.iv)
    iv[0] = (iv[0] ?? 0) ^ 1
    await expect(
      (await unlock(key)).decrypt(sealed.ciphertext, toBase64(iv)),
    ).rejects.toBeInstanceOf(DecryptError)
  })

  it('an 8-byte iv throws', async () => {
    const { key, sealed } = await sealNote('secreto')
    const iv = toBase64(fromBase64(sealed.iv).slice(0, 8))
    await expect((await unlock(key)).decrypt(sealed.ciphertext, iv)).rejects.toBeInstanceOf(
      DecryptError,
    )
  })

  it('malformed base64 throws', async () => {
    const { key, sealed } = await sealNote('secreto')
    const u = await unlock(key)
    await expect(u.decrypt(sealed.ciphertext + '!', sealed.iv)).rejects.toBeInstanceOf(DecryptError)
    await expect(u.decrypt(sealed.ciphertext.replace(/=+$/, ''), sealed.iv)).rejects.toBeInstanceOf(
      DecryptError,
    )
    expect(() => fromBase64('AB==')).toThrow()
    expect(fromBase64('QQ==')).toEqual(Uint8Array.of(65))
  })

  it('authHash equals sha256 of unlock auth', async () => {
    const { key, sealed } = await sealNote('hola', 'pw')
    const auth = (await unlock(key, 'pw')).auth
    expect(sealed.authHash).toBe(await sha256Base64(fromBase64(auth)))
    expect(fromBase64(auth)).toHaveLength(32)
  })

  it('different password gives different auth', async () => {
    const { key } = await sealNote('hola')
    const a = (await unlock(key, 'one')).auth
    const b = (await unlock(key, 'two')).auth
    expect(a).not.toBe(b)
    expect(a).not.toBe((await unlock(key)).auth)
  })

  it('password NFC and NFD forms open the same note', async () => {
    const nfc = 'café'
    const nfd = 'café'
    expect(nfc).not.toBe(nfd)
    const { key, sealed } = await sealNote('nota', nfc)
    expect(await (await unlock(key, nfd)).decrypt(sealed.ciphertext, sealed.iv)).toBe('nota')
    expect((await unlock(key, nfd)).auth).toBe((await unlock(key, nfc)).auth)
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

  it('pads every note to the same ciphertext length', async () => {
    const short = await sealNote('a')
    const long = await sealNote('a'.repeat(MAX_NOTE_BYTES))
    expect(fromBase64(short.sealed.ciphertext)).toHaveLength(MAX_NOTE_BYTES + 16)
    expect(fromBase64(long.sealed.ciphertext)).toHaveLength(MAX_NOTE_BYTES + 16)
  })

  it('keeps trailing whitespace and the full text through the padding', async () => {
    for (const text of ['línea\n\n  ', 'a'.repeat(MAX_NOTE_BYTES), '\u{1F600}'.repeat(2500)]) {
      const { key, sealed } = await sealNote(text)
      expect(await (await unlock(key)).decrypt(sealed.ciphertext, sealed.iv)).toBe(text)
    }
  })

  it('refuses U+0000 so the padding stays unambiguous', async () => {
    await expect(sealNote('abc\0')).rejects.toBeInstanceOf(RangeError)
    await expect(sealNote('a\0b')).rejects.toBeInstanceOf(RangeError)
  })

  it('emits standard base64 with a 12-byte iv and fresh randomness', async () => {
    const a = await sealNote('mismo texto')
    const b = await sealNote('mismo texto')
    expect(fromBase64(a.sealed.iv)).toHaveLength(12)
    expect(a.sealed.ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(a.sealed.ciphertext).not.toBe(b.sealed.ciphertext)
    expect(a.sealed.authHash).not.toBe(b.sealed.authHash)
  })

  it('derives the gate from the key alone and stores only its hash', async () => {
    const { key, sealed } = await sealNote('secreto', 'pw')
    const plain = await unlock(key)
    const withPassword = await unlock(key, 'pw')
    expect(withPassword.gate).toBe(plain.gate)
    expect(withPassword.auth).not.toBe(plain.auth)
    expect(plain.gate).not.toBe(plain.auth)
    const digest = await crypto.subtle.digest('SHA-256', fromBase64(plain.gate) as BufferSource)
    expect(toBase64(new Uint8Array(digest))).toBe(sealed.gateHash)
    expect((await unlock(new Uint8Array(32).fill(1))).gate).not.toBe(plain.gate)
  })
})
