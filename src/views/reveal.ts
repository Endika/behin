import { NetworkError, RequestError } from '@/api'
import { DecryptError, unlock } from '@/crypto'
import { copyText, h, icon } from '@/dom'
import { t, type MessageKey } from '@/i18n'
import { parseFragment } from '@/link'
import type { View, ViewDeps } from './types'

type Phase = 'incomplete' | 'ready' | 'revealed' | 'gone' | 'destroyed' | 'undecryptable'

export function revealView(container: HTMLElement, deps: ViewDeps): View {
  const link = parseFragment(deps.location.hash)
  let phase: Phase = link ? 'ready' : 'incomplete'
  let password = ''
  let busy = false
  let error: { key: MessageKey; params?: Record<string, number> } | null = null
  let plaintext = ''
  let animate = false

  function wipeFragment(): void {
    deps.history.replaceState(null, '', deps.location.pathname + deps.location.search)
  }

  function fail(cause: unknown): void {
    error = {
      key:
        cause instanceof NetworkError
          ? 'errNetwork'
          : cause instanceof RequestError
            ? 'errRequest'
            : 'errGeneric',
    }
  }

  async function reveal(): Promise<void> {
    const api = deps.api
    if (busy || !link || !api) return
    if (link.hasPassword && password.length === 0) return
    busy = true
    error = null
    draw()
    try {
      const unlocked = await unlock(link.key, link.hasPassword ? password : undefined)
      const result = await api.open(link.id, unlocked.auth)
      if (result.status === 'ok') {
        wipeFragment()
        try {
          plaintext = await unlocked.decrypt(result.ciphertext, result.iv)
          phase = 'revealed'
        } catch (cause) {
          if (!(cause instanceof DecryptError)) throw cause
          phase = 'undecryptable'
        }
        animate = true
      } else if (result.status === 'wrong') {
        if (result.remaining === 0) {
          wipeFragment()
          phase = 'destroyed'
          animate = true
        } else {
          password = ''
          error = {
            key: result.remaining === 1 ? 'wrongPasswordOne' : 'wrongPassword',
            params: { n: result.remaining },
          }
        }
      } else {
        wipeFragment()
        phase = 'gone'
        animate = true
      }
    } catch (cause) {
      fail(cause)
    }
    busy = false
    draw()
    if (phase === 'ready') document.getElementById('password')?.focus()
  }

  function notice(title: MessageKey, body: MessageKey, withLink = true): HTMLElement {
    return h(
      'div',
      { class: animate ? 'stack rise' : 'stack' },
      h('div', { class: 'lock muted-lock' }, icon('lock')),
      h('h1', {}, t(title)),
      h('p', { class: 'meta' }, t(body)),
      withLink
        ? h('a', { class: 'secondary', href: deps.location.pathname }, t('createNew'))
        : null,
    )
  }

  function drawReady(): HTMLElement {
    const button = h('button', { type: 'submit', class: 'primary' })
    function paint(): void {
      button.disabled = busy || !deps.api || (!!link?.hasPassword && password.length === 0)
      button.setAttribute('aria-busy', String(busy))
      button.replaceChildren(
        busy ? icon('spinner', 'spin') : '',
        busy ? t('revealing') : t('revealButton'),
      )
    }
    let field: HTMLElement | null = null
    if (link?.hasPassword) {
      const input = h('input', {
        id: 'password',
        class: 'field',
        type: 'password',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-invalid': error ? 'true' : undefined,
        oninput: (event) => {
          password = (event.target as HTMLInputElement).value
          paint()
        },
      })
      input.value = password
      field = h(
        'div',
        { class: 'stack tight' },
        h('label', { for: 'password' }, t('revealPasswordLabel')),
        input,
      )
    }
    paint()
    return h(
      'form',
      {
        class: 'stack',
        novalidate: true,
        onsubmit: (event) => {
          event.preventDefault()
          void reveal()
        },
      },
      h('div', { class: 'lock' }, icon('lock')),
      h('h1', {}, t('revealTitle')),
      field,
      error
        ? h(
            'p',
            { class: 'banner', role: 'alert' },
            icon('alert'),
            h('span', {}, t(error.key, error.params)),
          )
        : null,
      button,
      h('p', { class: 'hint center' }, t('revealHint')),
    )
  }

  function drawRevealed(): HTMLElement {
    const code = h('pre', { class: 'code', id: 'note' })
    code.textContent = plaintext
    const label = h('span', {}, t('copy'))
    const status = h('p', { class: 'hint', role: 'status' })
    const button = h('button', { type: 'button', class: 'copy' }, icon('copy'), label)
    button.addEventListener('click', async () => {
      const ok = await copyText(plaintext, code)
      label.textContent = ok ? t('copied') : t('copy')
      status.textContent = ok ? '' : t('copyFailed')
    })
    return h(
      'div',
      { class: animate ? 'stack rise' : 'stack' },
      h('h1', {}, t('revealedTitle')),
      code,
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'chip' }, icon('check'), t('chipDeleted')),
        button,
      ),
      status,
      h('a', { class: 'secondary', href: deps.location.pathname }, t('createNew')),
    )
  }

  function draw(): void {
    let view: HTMLElement
    switch (phase) {
      case 'incomplete':
        view = notice('incompleteTitle', 'incompleteBody')
        break
      case 'ready':
        view = drawReady()
        break
      case 'revealed':
        view = drawRevealed()
        break
      case 'gone':
        view = notice('goneTitle', 'goneBody')
        break
      case 'destroyed':
        view = notice('destroyedTitle', 'destroyedBody')
        break
      case 'undecryptable':
        view = notice('decryptTitle', 'decryptBody')
        break
    }
    container.replaceChildren(view)
    animate = false
  }

  return { draw }
}
