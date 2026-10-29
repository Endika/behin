import { describe, expect, it } from 'vitest'
import { LOCALES, detectLocale, setLocale, t, tables } from '@/i18n'

describe('i18n', () => {
  it('gives every locale exactly the same non-empty keys', () => {
    const keys = Object.keys(tables.es).sort()
    for (const locale of LOCALES) {
      expect(Object.keys(tables[locale]).sort(), locale).toEqual(keys)
      for (const [key, value] of Object.entries(tables[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe('')
      }
    }
  })

  it('keeps the same placeholders in every locale', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()
    for (const locale of LOCALES) {
      for (const key of Object.keys(tables.es) as (keyof typeof tables.es)[]) {
        const expected = placeholders(tables.es[key])
        expect(placeholders(tables[locale][key]), `${locale}.${key}`).toEqual(expected)
      }
    }
  })

  it('detects by primary subtag and falls back to English', () => {
    expect(detectLocale(['eu-ES'])).toBe('eu')
    expect(detectLocale(['pt-BR'])).toBe('en')
    expect(detectLocale(['pt-BR', 'gl'])).toBe('gl')
    expect(detectLocale([])).toBe('en')
  })

  it('fills placeholders', () => {
    setLocale('en')
    expect(t('noteCounter', { n: 3, max: 10 })).toBe('3 / 10 bytes')
  })
})
