import { unlock } from '@/crypto'
import { h, icon } from '@/dom'
import { t, type MessageKey } from '@/i18n'
import { parseFragment } from '@/link'
import { copyButton } from './copy'
import { failureError, nextStep, type Phase, type RevealError } from './reveal-flow'
import type { View, ViewDeps } from './types'

export function revealView(container: HTMLElement, deps: ViewDeps): View {
  const link = parseFragment(deps.location.hash)
  let phase: Phase = link ? 'ready' : 'incomplete'
  let password = ''
  let busy = false
  let error: RevealError | null = null
  let plaintext = ''
  let animate = false
  let disposed = false
  let refresh: () => void = () => {}

  function wipeFragment(): void {
    deps.history.replaceState(null, '', deps.location.pathname + deps.location.search)
  }

  if (!link) wipeFragment()

  // The back/forward cache would otherwise restore the revealed text to anyone
  // who presses Back in this browser.
  function forgetOnLeave(): void {
    if (phase !== 'revealed') return
    plaintext = ''
    phase = 'gone'
    draw()
  }
  window.addEventListener('pagehide', forgetOnLeave)

  async function reveal(): Promise<void> {
    if (busy || !link) return
    if (link.hasPassword && password.length === 0) return
    busy = true
    error = null
    refresh()
    try {
      const unlocked = await unlock(link.key, link.hasPassword ? password : undefined)
      const result = await deps.api.open(link.id, unlocked.gate, unlocked.auth)
      if (disposed) return
      const step = nextStep(result, link.hasPassword)
      if (step.wipe) wipeFragment()
      if (result.status === 'ok') {
        try {
          plaintext = await unlocked.decrypt(result.ciphertext, result.iv)
          phase = 'revealed'
        } catch {
          phase = 'undecryptable'
        }
      } else if (step.next === 'ready') {
        password = ''
        error = step.error
      } else {
        phase = step.next
      }
    } catch (cause) {
      error = failureError(cause)
    }
    if (disposed) return
    busy = false
    if (phase === 'ready') {
      refresh()
      const input = container.querySelector<HTMLInputElement>('#password')
      if (input) {
        input.value = ''
        input.focus()
      } else {
        container.querySelector<HTMLElement>('button[type="submit"]')?.focus()
      }
    } else {
      animate = true
      draw(true)
    }
  }

  function notice(title: MessageKey, body: MessageKey): HTMLElement {
    return h(
      'div',
      { class: animate ? 'stack rise' : 'stack' },
      h('div', { class: 'lock muted-lock' }, icon('lock')),
      h('h1', { tabindex: '-1' }, t(title)),
      h('p', { class: 'meta' }, t(body)),
      h('a', { class: 'secondary', href: deps.location.pathname }, t('createNew')),
    )
  }

  function drawReady(): HTMLElement {
    const button = h('button', { type: 'submit', class: 'primary' })
    const banner = h('div', { class: 'banner-slot' })
    function paint(): void {
      button.disabled = busy || (!!link?.hasPassword && password.length === 0)
      button.setAttribute('aria-busy', String(busy))
      button.replaceChildren(
        busy ? icon('spinner', 'spin') : '',
        busy ? t('revealing') : t('revealButton'),
      )
      banner.replaceChildren(
        ...(error
          ? [
              h(
                'p',
                { class: 'banner', role: 'alert' },
                icon('alert'),
                h('span', {}, t(error.key, error.params)),
              ),
            ]
          : []),
      )
    }
    let field: HTMLElement | null = null
    if (link?.hasPassword) {
      const input = h('input', {
        id: 'password',
        class: 'field',
        type: 'password',
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
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
    refresh = paint
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
      h('h1', { tabindex: '-1' }, t('revealTitle')),
      h('p', { class: 'meta' }, t('revealMeta')),
      field,
      banner,
      button,
      h('p', { class: 'hint' }, t('revealHint')),
    )
  }

  function drawRevealed(): HTMLElement {
    const code = h('pre', { class: 'code', id: 'note' })
    code.textContent = plaintext
    const status = h('p', { class: 'hint', role: 'status' })
    const button = copyButton(plaintext, code, status, 'copy', 'copy')
    return h(
      'div',
      { class: animate ? 'stack rise' : 'stack' },
      h('h1', { tabindex: '-1' }, t('revealedTitle')),
      code,
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'chip' }, icon('check'), t('chipDeleted')),
        button,
      ),
      status,
      h('a', { class: 'link-btn', href: deps.location.pathname }, t('createNew')),
    )
  }

  function draw(focusHeading = false): void {
    if (disposed) return
    let view: HTMLElement
    switch (phase) {
      case 'incomplete':
        view = notice('incompleteTitle', 'incompleteBody')
        break
      case 'damaged':
        view = notice('damagedTitle', 'damagedBody')
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
    if (focusHeading) container.querySelector<HTMLElement>('h1')?.focus()
  }

  return {
    draw: () => draw(),
    dispose: () => {
      disposed = true
      window.removeEventListener('pagehide', forgetOnLeave)
    },
  }
}
