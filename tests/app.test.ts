import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NetworkError, type NotesApi } from '@/api'
import { mountApp } from '@/app'
import { MAX_NOTE_BYTES, sealNote } from '@/crypto'
import { setLocale, t } from '@/i18n'
import { buildLink } from '@/link'
import { createFakeApi, type FakeApi, type FakeRow } from './fake-api'

let root: HTMLElement
let dispose: () => void
let fake: FakeApi
let opens: number
let api: NotesApi

function mount(hash = '', storage: Storage = localStorage): void {
  window.history.replaceState(null, '', '/behin/' + hash)
  dispose = mountApp(root, { api, location: window.location, history: window.history, storage })
}

function $<T extends HTMLElement>(selector: string): T {
  const el = root.querySelector<T>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}

function submit(): void {
  $<HTMLFormElement>('form').requestSubmit()
}

function type(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function seed(text: string, password?: string): Promise<string> {
  const { key, sealed } = await sealNote(text, password)
  const id = await fake.create(sealed, 86400)
  return buildLink('', id, key, password !== undefined)
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('behin.locale', 'es')
  setLocale('es')
  root = document.createElement('div')
  document.body.replaceChildren(root)
  fake = createFakeApi()
  opens = 0
  api = {
    create: (sealed, ttl) => fake.create(sealed, ttl),
    open: (id, auth) => {
      opens += 1
      return fake.open(id, auth)
    },
  }
})

afterEach(() => dispose())

describe('create view', () => {
  it('creates a link with a fragment and stores only ciphertext', async () => {
    mount()
    type($('textarea'), 'tortuga-azul-73')
    submit()
    const field = await vi.waitFor(() => $<HTMLInputElement>('#link'))
    expect(field.value).toMatch(
      /^http:\/\/localhost:\d+\/behin\/#[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/,
    )
    expect(fake.rows().size).toBe(1)
    expect(root.textContent).toContain(t('linkExpiry', { ttl: t('ttlLong86400') }))
    expect(root.textContent).not.toContain(t('linkPassword'))
  })

  it('adds the password hint and a .p suffix when a password is set', async () => {
    mount()
    type($('textarea'), 'secret')
    ;($('.link-btn') as HTMLButtonElement).click()
    type($('#password'), 'hunter2')
    submit()
    const field = await vi.waitFor(() => $<HTMLInputElement>('#link'))
    expect(field.value.endsWith('.p')).toBe(true)
    expect(root.textContent).toContain(t('linkPassword'))
  })

  it('offers four expiry options with one day selected', () => {
    mount()
    const radios = [...root.querySelectorAll<HTMLInputElement>('input[name="ttl"]')]
    expect(radios.map((r) => r.value)).toEqual(['600', '3600', '86400', '604800'])
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(['86400'])
  })

  it('uses the chosen expiry', async () => {
    mount()
    const radio = root.querySelector<HTMLInputElement>('input[value="600"]')!
    radio.checked = true
    radio.dispatchEvent(new Event('change', { bubbles: true }))
    type($('textarea'), 'x')
    const before = Date.now()
    submit()
    await vi.waitFor(() => $('#link'))
    const [row] = [...fake.rows().values()]
    expect(row!.expiresAt - before).toBeLessThan(11 * 60 * 1000)
  })

  it('disables creation for an empty or oversized note and shows a warning', () => {
    mount()
    const submit = $<HTMLButtonElement>('button[type="submit"]')
    expect(submit.disabled).toBe(true)
    type($('textarea'), 'a'.repeat(MAX_NOTE_BYTES + 1))
    expect(submit.disabled).toBe(true)
    expect($('#too-long').textContent).toBe(t('noteTooLong', { max: MAX_NOTE_BYTES }))
    expect($('#counter').classList.contains('over')).toBe(true)
    type($('textarea'), 'a'.repeat(MAX_NOTE_BYTES))
    expect(submit.disabled).toBe(false)
  })

  it('shows the counter only above 80% of the limit', () => {
    mount()
    type($('textarea'), 'a'.repeat(100))
    expect($('#counter').textContent).toBe('')
    type($('textarea'), 'a'.repeat(8_001))
    expect($('#counter').textContent).toBe(t('noteCounter', { n: 8_001, max: MAX_NOTE_BYTES }))
  })

  it('keeps the form and shows a specific message on a network error', async () => {
    mount()
    type($('textarea'), 'keep me')
    fake.failNext(new NetworkError())
    submit()
    await vi.waitFor(() => expect(root.textContent).toContain(t('errNetwork')))
    expect($<HTMLTextAreaElement>('textarea').value).toBe('keep me')
    expect($<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false)
  })

  it('falls back to selecting the link when the clipboard is unavailable', async () => {
    mount()
    type($('textarea'), 'x')
    submit()
    await vi.waitFor(() => $('#link'))
    $<HTMLButtonElement>('.copy').click()
    await vi.waitFor(() => expect(root.textContent).toContain(t('copyFailed')))
  })
})

describe('reveal view', () => {
  it('makes no calls until Revelar is pressed, then shows the note and wipes the fragment', async () => {
    const hash = await seed('Wi-Fi casa: tortuga-azul-73')
    mount(hash)
    expect(root.textContent).toContain(t('revealTitle'))
    expect(root.textContent).toContain(t('revealHint'))
    expect(opens).toBe(0)
    expect(fake.rows().size).toBe(1)
    submit()
    await vi.waitFor(() => expect($('#note').textContent).toBe('Wi-Fi casa: tortuga-azul-73'))
    expect(opens).toBe(1)
    expect(window.location.hash).toBe('')
    expect(fake.rows().size).toBe(0)
    expect(root.textContent).toContain(t('chipDeleted'))
  })

  it('renders the note as text, never as HTML', async () => {
    const payload = '<img src=x onerror=alert(1)>'
    mount(await seed(payload))
    submit()
    await vi.waitFor(() => expect($('#note').textContent).toBe(payload))
    expect(root.querySelector('img')).toBeNull()
  })

  it('says the note is gone when the link is opened a second time', async () => {
    const hash = await seed('once')
    mount(hash)
    submit()
    await vi.waitFor(() => $('#note'))
    dispose()
    mount(hash)
    submit()
    await vi.waitFor(() => expect(root.textContent).toContain(t('goneTitle')))
    expect(window.location.hash).toBe('')
  })

  it('asks for the password and reports the attempts left', async () => {
    const hash = await seed('guarded', 'right')
    expect(hash.endsWith('.p')).toBe(true)
    mount(hash)
    const button = $<HTMLButtonElement>('button[type="submit"]')
    expect(button.disabled).toBe(true)
    type($('#password'), 'wrong')
    submit()
    await vi.waitFor(() => expect(root.textContent).toContain(t('wrongPassword', { n: 4 })))
    expect(window.location.hash).not.toBe('')
    type($('#password'), 'right')
    submit()
    await vi.waitFor(() => expect($('#note').textContent).toBe('guarded'))
  })

  it('shows a destroyed state when the attempts run out', async () => {
    mount(await seed('guarded', 'right'))
    for (let i = 0; i < 5; i++) {
      type($('#password'), `bad${i}`)
      submit()
      await vi.waitFor(() => expect(root.textContent).not.toContain('Abriendo'))
    }
    await vi.waitFor(() => expect(root.textContent).toContain(t('destroyedTitle')))
    expect(fake.rows().size).toBe(0)
  })

  it('shows an incomplete-link state without any API call', () => {
    mount('#123e4567-e89b-42d3-a456-426614174000.tooshort')
    expect(root.textContent).toContain(t('incompleteTitle'))
    expect(opens).toBe(0)
    expect(root.querySelector('button[type="submit"]')).toBeNull()
  })

  it('keeps the note recoverable after a network error', async () => {
    const hash = await seed('still here')
    mount(hash)
    fake.failNext(new NetworkError())
    submit()
    await vi.waitFor(() => expect(root.textContent).toContain(t('errNetwork')))
    expect($<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false)
    expect(window.location.hash).not.toBe('')
    expect(fake.rows().size).toBe(1)
    submit()
    await vi.waitFor(() => expect($('#note').textContent).toBe('still here'))
  })

  it('shows a failure state when the stored bytes do not decrypt', async () => {
    const hash = await seed('tampered')
    const [row] = [...fake.rows().values()]
    const other = await sealNote('other')
    ;(row as FakeRow).ciphertext = other.sealed.ciphertext
    mount(hash)
    submit()
    await vi.waitFor(() => expect(root.textContent).toContain(t('decryptTitle')))
    expect(window.location.hash).toBe('')
  })
})

describe('language', () => {
  it('stores the chosen language and updates the document', () => {
    mount()
    const picker = $<HTMLSelectElement>('#locale')
    expect([...picker.options].map((o) => o.text)).toEqual([
      'Español',
      'English',
      'Euskara',
      'Català',
      'Galego',
    ])
    picker.value = 'eu'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    expect(localStorage.getItem('behin.locale')).toBe('eu')
    expect(document.documentElement.lang).toBe('eu')
    expect(root.textContent).toContain(t('createTitle'))
    expect(t('createTitle')).toBe('Idatzi ohar sekretu bat')
  })

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    mount('', broken)
    const picker = $<HTMLSelectElement>('#locale')
    picker.value = 'ca'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    expect(document.documentElement.lang).toBe('ca')
  })
})
