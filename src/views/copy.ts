import { copyText, h, icon } from '@/dom'
import { t, type MessageKey } from '@/i18n'

export function copyButton(
  text: string,
  fallbackTarget: HTMLElement,
  note: HTMLElement,
  key: MessageKey,
  className: string,
): HTMLButtonElement {
  const label = h('span', {}, t(key))
  const button = h('button', { type: 'button', class: className }, icon('copy'), label)
  let timer: ReturnType<typeof setTimeout> | undefined
  button.addEventListener('click', async () => {
    const ok = await copyText(text, fallbackTarget)
    clearTimeout(timer)
    label.textContent = ok ? t('copied') : t(key)
    button.replaceChildren(icon(ok ? 'check' : 'copy'), label)
    note.textContent = ok ? '' : t('copyFailed')
    if (ok) {
      timer = setTimeout(() => {
        label.textContent = t(key)
        button.replaceChildren(icon('copy'), label)
      }, 2000)
    }
  })
  return button
}
