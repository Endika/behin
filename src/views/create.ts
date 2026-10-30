import { CapacityError, NetworkError, RequestError, type TtlSeconds } from '@/api'
import { MAX_NOTE_BYTES, sealNote, utf8Bytes } from '@/crypto'
import { h, icon } from '@/dom'
import { t, type MessageKey } from '@/i18n'
import { buildLink } from '@/link'
import { copyButton } from './copy'
import type { View, ViewDeps } from './types'

const TTLS: readonly TtlSeconds[] = [600, 3600, 86400, 604800]
const NO_AUTOFIX = { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }

type Result = { link: string; ttl: TtlSeconds; hasPassword: boolean }

export function createView(container: HTMLElement, deps: ViewDeps): View {
  let text = ''
  let password = ''
  let passwordOpen = false
  let passwordShown = false
  let ttl: TtlSeconds = 86400
  let busy = false
  let error: MessageKey | null = null
  let result: Result | null = null
  let animate = false
  let disposed = false
  let refresh: () => void = () => {}

  function errorKey(cause: unknown): MessageKey {
    if (cause instanceof CapacityError) return 'errCapacity'
    if (cause instanceof NetworkError) return 'errNetwork'
    if (cause instanceof RequestError) return 'errRequest'
    return 'errGeneric'
  }

  const isEmpty = (): boolean => text.trim().length === 0
  const isOver = (): boolean => utf8Bytes(text) > MAX_NOTE_BYTES
  const hasNull = (): boolean => text.includes('\0')
  const isInvalid = (): boolean => isEmpty() || isOver() || hasNull()

  async function submit(): Promise<void> {
    if (busy || isInvalid()) return
    busy = true
    error = null
    refresh()
    try {
      const usedPassword = passwordOpen && password.length > 0 ? password : undefined
      const { key, sealed } = await sealNote(text, usedPassword)
      const id = await deps.api.create(sealed, ttl)
      if (disposed) return
      const base = deps.location.origin + deps.location.pathname
      result = {
        link: buildLink(base, id, key, usedPassword !== undefined),
        ttl,
        hasPassword: usedPassword !== undefined,
      }
      animate = true
      busy = false
      draw(true)
      return
    } catch (cause) {
      error = errorKey(cause)
    }
    if (disposed) return
    busy = false
    refresh()
  }

  function resetForm(): void {
    text = ''
    password = ''
    passwordOpen = false
    passwordShown = false
    result = null
    error = null
  }

  function drawResult(done: Result): HTMLElement {
    const block = h('p', {
      class: 'code link',
      id: 'link',
      role: 'group',
      'aria-labelledby': 'link-label',
    })
    block.textContent = done.link
    const note = h('p', { class: 'hint', role: 'status' })
    const copyBtn = copyButton(done.link, block, note, 'copyLink', 'primary')
    return h(
      'div',
      { class: animate ? 'stack rise' : 'stack' },
      h('div', { class: 'lock' }, icon('lock')),
      h('h1', { tabindex: '-1' }, t('linkTitle')),
      h('span', { class: 'sr', id: 'link-label' }, t('linkLabel')),
      block,
      copyBtn,
      note,
      h('p', { class: 'meta' }, t('linkExpiry', { ttl: t(`ttlLong${done.ttl}`) })),
      done.hasPassword ? h('p', { class: 'meta strong' }, t('linkPassword')) : null,
      h(
        'button',
        {
          type: 'button',
          class: 'link-btn',
          onclick: () => {
            resetForm()
            draw(true)
          },
        },
        t('createAnother'),
      ),
    )
  }

  function drawForm(): HTMLElement {
    const counter = h('p', { class: 'counter', id: 'counter' })
    const warn = h('p', { class: 'error', id: 'too-long', role: 'alert' })
    const banner = h('div', { class: 'banner-slot' })
    const submitBtn = h('button', { type: 'submit', class: 'primary' })
    let lastWarning: MessageKey | null = null

    function paintCounter(): void {
      const n = utf8Bytes(text)
      counter.textContent =
        n > MAX_NOTE_BYTES * 0.8 ? t('noteCounter', { n, max: MAX_NOTE_BYTES }) : ''
      counter.classList.toggle('over', n > MAX_NOTE_BYTES)
      const warning: MessageKey | null =
        n > MAX_NOTE_BYTES ? 'noteTooLong' : hasNull() ? 'noteHasNull' : null
      if (warning !== lastWarning) {
        lastWarning = warning
        warn.textContent = warning ? t(warning, { max: MAX_NOTE_BYTES }) : ''
        area.setAttribute('aria-invalid', String(warning !== null))
      }
    }

    function paintSubmit(): void {
      submitBtn.disabled = busy || isInvalid()
      submitBtn.replaceChildren(
        busy ? icon('spinner', 'spin') : '',
        busy ? t('creating') : t('createButton'),
      )
      submitBtn.setAttribute('aria-busy', String(busy))
    }

    function paintBanner(): void {
      banner.replaceChildren(
        ...(error
          ? [h('p', { class: 'banner', role: 'alert' }, icon('alert'), h('span', {}, t(error)))]
          : []),
      )
    }

    const area = h('textarea', {
      id: 'note',
      class: 'field',
      rows: '6',
      placeholder: t('notePlaceholder'),
      autocomplete: 'off',
      ...NO_AUTOFIX,
      'aria-describedby': 'counter too-long',
      onkeydown: (event) => {
        const key = event as KeyboardEvent
        if (key.key === 'Enter' && (key.ctrlKey || key.metaKey)) {
          key.preventDefault()
          void submit()
        }
      },
      oninput: (event) => {
        text = (event.target as HTMLTextAreaElement).value
        paintCounter()
        paintSubmit()
      },
    })
    area.value = text
    paintCounter()

    let passwordBlock: HTMLElement
    if (passwordOpen) {
      const input = h('input', {
        id: 'password',
        class: 'field',
        type: passwordShown ? 'text' : 'password',
        autocomplete: 'new-password',
        ...NO_AUTOFIX,
        oninput: (event) => {
          password = (event.target as HTMLInputElement).value
        },
      })
      input.value = password
      const eye = h('button', { type: 'button', class: 'icon-btn' })
      const paintEye = (): void => {
        eye.setAttribute('aria-label', passwordShown ? t('hidePassword') : t('showPassword'))
        eye.setAttribute('aria-pressed', String(passwordShown))
        eye.replaceChildren(icon(passwordShown ? 'eyeOff' : 'eye'))
      }
      eye.addEventListener('click', () => {
        passwordShown = !passwordShown
        input.type = passwordShown ? 'text' : 'password'
        paintEye()
      })
      paintEye()
      passwordBlock = h(
        'div',
        { class: 'stack tight' },
        h('label', { for: 'password' }, t('passwordLabel')),
        h('div', { class: 'field-row' }, input, eye),
        h(
          'button',
          {
            type: 'button',
            class: 'link-btn',
            onclick: () => {
              passwordOpen = false
              password = ''
              passwordShown = false
              draw()
              document.getElementById('note')?.focus()
            },
          },
          t('removePassword'),
        ),
      )
    } else {
      passwordBlock = h(
        'button',
        {
          type: 'button',
          class: 'link-btn',
          onclick: () => {
            passwordOpen = true
            draw()
            document.getElementById('password')?.focus()
          },
        },
        t('addPassword'),
      )
    }

    const seg = h(
      'fieldset',
      { class: 'seg-group' },
      h('legend', {}, t('ttlLabel')),
      h(
        'div',
        { class: 'seg' },
        ...TTLS.map((value) => {
          const radio = h('input', {
            type: 'radio',
            name: 'ttl',
            value: String(value),
            onchange: () => {
              ttl = value
            },
          })
          radio.checked = value === ttl
          return h('label', {}, radio, h('span', {}, t(`ttl${value}`)))
        }),
      ),
    )

    refresh = () => {
      paintSubmit()
      paintBanner()
    }
    refresh()
    return h(
      'form',
      {
        class: 'stack',
        novalidate: true,
        onsubmit: (event) => {
          event.preventDefault()
          void submit()
        },
      },
      h('div', { class: 'lock' }, icon('lock')),
      h('h1', { tabindex: '-1' }, t('createTitle')),
      h('p', { class: 'meta' }, t('createLead')),
      h(
        'div',
        { class: 'stack tight' },
        h('label', { for: 'note' }, t('noteLabel')),
        area,
        counter,
        warn,
      ),
      passwordBlock,
      seg,
      banner,
      submitBtn,
    )
  }

  function draw(focusHeading = false): void {
    if (disposed) return
    container.replaceChildren(result ? drawResult(result) : drawForm())
    animate = false
    if (focusHeading) container.querySelector<HTMLElement>('h1')?.focus()
  }

  return {
    draw: () => draw(),
    dispose: () => {
      disposed = true
    },
  }
}
