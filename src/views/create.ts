import { CapacityError, NetworkError, RequestError, type TtlSeconds } from '@/api'
import { MAX_NOTE_BYTES, sealNote, utf8Bytes } from '@/crypto'
import { copyText, h, icon } from '@/dom'
import { t, type MessageKey } from '@/i18n'
import { buildLink } from '@/link'
import type { View, ViewDeps } from './types'

const TTLS: readonly TtlSeconds[] = [600, 3600, 86400, 604800]

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

  function errorKey(cause: unknown): MessageKey {
    if (cause instanceof CapacityError) return 'errCapacity'
    if (cause instanceof NetworkError) return 'errNetwork'
    if (cause instanceof RequestError) return 'errRequest'
    return 'errGeneric'
  }

  async function submit(): Promise<void> {
    const api = deps.api
    if (busy || !api || text.length === 0 || utf8Bytes(text) > MAX_NOTE_BYTES) return
    busy = true
    error = null
    draw()
    try {
      const usedPassword = passwordOpen && password.length > 0 ? password : undefined
      const { key, sealed } = await sealNote(text, usedPassword)
      const id = await api.create(sealed, ttl)
      const base = deps.location.origin + deps.location.pathname
      result = {
        link: buildLink(base, id, key, usedPassword !== undefined),
        ttl,
        hasPassword: usedPassword !== undefined,
      }
      animate = true
    } catch (cause) {
      error = errorKey(cause)
    }
    busy = false
    draw()
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
    const field = h('input', {
      class: 'field mono',
      id: 'link',
      type: 'text',
      readonly: true,
      value: done.link,
      'aria-label': t('linkLabel'),
      spellcheck: 'false',
      autocomplete: 'off',
      onfocus: (event) => (event.target as HTMLInputElement).select(),
    })
    field.value = done.link
    const copyLabel = h('span', {}, t('copy'))
    const copyBtn = h('button', { type: 'button', class: 'copy' }, icon('copy'), copyLabel)
    const note = h('p', { class: 'hint', role: 'status' })
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(done.link, field)
      copyLabel.textContent = ok ? t('copied') : t('copy')
      note.textContent = ok ? '' : t('copyFailed')
    })
    return h(
      'div',
      { class: animate ? 'stack rise' : 'stack' },
      h('div', { class: 'lock' }, icon('lock')),
      h('h1', {}, t('linkTitle')),
      h(
        'div',
        { class: 'field-row' },
        h('label', { class: 'sr', for: 'link' }, t('linkLabel')),
        field,
        copyBtn,
      ),
      note,
      h('p', { class: 'meta' }, t('linkExpiry', { ttl: t(`ttlLong${done.ttl}`) })),
      done.hasPassword ? h('p', { class: 'meta strong' }, t('linkPassword')) : null,
      h(
        'button',
        {
          type: 'button',
          class: 'secondary',
          onclick: () => {
            resetForm()
            draw()
          },
        },
        t('createAnother'),
      ),
    )
  }

  function drawForm(): HTMLElement {
    const bytes = utf8Bytes(text)
    const over = bytes > MAX_NOTE_BYTES
    const showCounter = bytes > MAX_NOTE_BYTES * 0.8
    const counter = h(
      'p',
      { class: over ? 'counter over' : 'counter', id: 'counter' },
      showCounter ? t('noteCounter', { n: bytes, max: MAX_NOTE_BYTES }) : '',
    )
    const warn = h('p', { class: 'error', id: 'too-long', role: 'alert' })
    const submitBtn = h('button', { type: 'submit', class: 'primary' })

    function paintSubmit(): void {
      const disabled = busy || text.length === 0 || utf8Bytes(text) > MAX_NOTE_BYTES
      submitBtn.disabled = disabled
      submitBtn.replaceChildren(
        busy ? icon('spinner', 'spin') : '',
        busy ? t('creating') : t('createButton'),
      )
      submitBtn.setAttribute('aria-busy', String(busy))
    }

    const area = h('textarea', {
      id: 'note',
      class: 'field mono',
      rows: '6',
      placeholder: t('notePlaceholder'),
      spellcheck: 'false',
      autocomplete: 'off',
      'aria-describedby': 'counter too-long',
      oninput: (event) => {
        text = (event.target as HTMLTextAreaElement).value
        const n = utf8Bytes(text)
        const isOver = n > MAX_NOTE_BYTES
        counter.textContent =
          n > MAX_NOTE_BYTES * 0.8 ? t('noteCounter', { n, max: MAX_NOTE_BYTES }) : ''
        counter.classList.toggle('over', isOver)
        warn.textContent = isOver ? t('noteTooLong', { max: MAX_NOTE_BYTES }) : ''
        area.setAttribute('aria-invalid', String(isOver))
        paintSubmit()
      },
    })
    area.value = text
    if (over) {
      warn.textContent = t('noteTooLong', { max: MAX_NOTE_BYTES })
      area.setAttribute('aria-invalid', 'true')
    }

    let passwordBlock: HTMLElement
    if (passwordOpen) {
      const input = h('input', {
        id: 'password',
        class: 'field',
        type: passwordShown ? 'text' : 'password',
        autocomplete: 'new-password',
        spellcheck: 'false',
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

    paintSubmit()
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
      h('h1', {}, t('createTitle')),
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
      error
        ? h('p', { class: 'banner', role: 'alert' }, icon('alert'), h('span', {}, t(error)))
        : null,
      submitBtn,
    )
  }

  function draw(): void {
    container.replaceChildren(result ? drawResult(result) : drawForm())
    animate = false
  }

  return { draw }
}
