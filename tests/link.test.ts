import { describe, expect, it } from 'vitest'
import { buildLink, parseFragment } from '@/link'

const ID = '123e4567-e89b-42d3-a456-426614174000'
const key = Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 7)

function keyPart(): string {
  return buildLink('', ID, key, false).slice(ID.length + 2)
}

describe('link', () => {
  it('builds a link with a 43 char url-safe key', () => {
    const link = buildLink('https://x.test/behin/', ID, key, false)
    expect(link.startsWith(`https://x.test/behin/#${ID}.`)).toBe(true)
    expect(keyPart()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('appends .p only with a password', () => {
    expect(buildLink('b', ID, key, true)).toBe(`b#${ID}.${keyPart()}.p`)
    expect(buildLink('b', ID, key, false).endsWith('.p')).toBe(false)
  })

  it('roundtrips build and parse', () => {
    for (const hasPassword of [false, true]) {
      const hash = buildLink('', ID, key, hasPassword)
      expect(parseFragment(hash)).toEqual({ id: ID, key, hasPassword })
    }
  })

  it('accepts a fragment without the leading #', () => {
    expect(parseFragment(`${ID}.${keyPart()}`)).toEqual({ id: ID, key, hasPassword: false })
  })

  it('accepts surrounding whitespace', () => {
    expect(parseFragment(`  #${ID}.${keyPart()}.p\n`)).toEqual({
      id: ID,
      key,
      hasPassword: true,
    })
  })

  it('returns null for empty input', () => {
    expect(parseFragment('')).toBeNull()
    expect(parseFragment('#')).toBeNull()
  })

  it('returns null for a bad uuid', () => {
    expect(parseFragment(`#not-a-uuid.${keyPart()}`)).toBeNull()
    expect(parseFragment(`#${ID.toUpperCase()}.${keyPart()}`)).toBeNull()
  })

  it('returns null for keys of 42 and 44 chars', () => {
    expect(parseFragment(`#${ID}.${keyPart().slice(1)}`)).toBeNull()
    expect(parseFragment(`#${ID}.${keyPart()}A`)).toBeNull()
  })

  it('returns null for a key that is not 32 bytes of valid base64url', () => {
    expect(parseFragment(`#${ID}.${'+'.repeat(43)}`)).toBeNull()
    expect(parseFragment(`#${ID}.${'B'.repeat(43)}`)).toBeNull()
    expect(parseFragment(`#${ID}.${'A'.repeat(43)}`)).not.toBeNull()
  })

  it('returns null for a suffix other than p', () => {
    expect(parseFragment(`#${ID}.${keyPart()}.x`)).toBeNull()
    expect(parseFragment(`#${ID}.${keyPart()}.`)).toBeNull()
  })

  it('returns null for an extra fourth part', () => {
    expect(parseFragment(`#${ID}.${keyPart()}.p.x`)).toBeNull()
  })

  it('returns null for percent-encoded or inner-whitespace fragments', () => {
    expect(parseFragment(`#${ID}%2E${keyPart()}`)).toBeNull()
    expect(parseFragment(`#${ID}.${keyPart().replace('', '%41').slice(0, 43)}`)).toBeNull()
    expect(parseFragment(`#${ID}. ${keyPart()}`)).toBeNull()
  })
})
