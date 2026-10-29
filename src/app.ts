import type { NotesApi } from '@/api'
import { h, icon } from '@/dom'
import {
  LOCALES,
  LOCALE_NAMES,
  detectLocale,
  getLocale,
  isLocale,
  setLocale,
  t,
  type Locale,
} from '@/i18n'
import { createView } from '@/views/create'
import { revealView } from '@/views/reveal'
import type { View } from '@/views/types'

export const STORAGE_KEY = 'behin.locale'
const SOURCE_URL = 'https://github.com/Endika/behin'

export interface AppDeps {
  api: NotesApi | null
  location: Location
  history: History
  storage: Storage
  isFramed?: () => boolean
}

function readStoredLocale(storage: Storage): Locale | null {
  try {
    const value = storage.getItem(STORAGE_KEY)
    return isLocale(value) ? value : null
  } catch {
    return null
  }
}

function storeLocale(storage: Storage, locale: Locale): void {
  try {
    storage.setItem(STORAGE_KEY, locale)
  } catch {
    // Storage can be blocked; the choice then lasts only for this visit.
  }
}

export function mountApp(root: HTMLElement, deps: AppDeps): () => void {
  setLocale(readStoredLocale(deps.storage) ?? detectLocale(navigator.languages))

  const picker = h('select', { id: 'locale' })
  for (const locale of LOCALES) {
    picker.append(h('option', { value: locale }, LOCALE_NAMES[locale]))
  }
  const main = h('main', { class: 'card' })
  const footer = h('footer', { class: 'foot' })
  root.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h(
        'a',
        { class: 'logo', href: deps.location.pathname },
        h('i', { 'aria-hidden': 'true' }),
        'behin',
      ),
      h('div', { class: 'lang' }, picker, icon('chevron')),
    ),
    main,
    footer,
  )

  let view: View | null = null

  function drawFooter(): void {
    footer.replaceChildren(
      h('p', {}, icon('lock'), t('footer')),
      h(
        'details',
        {},
        h('summary', {}, t('howTitle')),
        h(
          'div',
          { class: 'how' },
          h('p', {}, t('howPlain')),
          h(
            'ul',
            {},
            ...(
              [
                'howAes',
                'howKey',
                'howServer',
                'howDelete',
                'howPassword',
                'howAttempts',
                'howTtl',
              ] as const
            ).map((key) => h('li', {}, t(key))),
          ),
          h('a', { href: SOURCE_URL, rel: 'noopener noreferrer' }, t('howSource')),
        ),
      ),
    )
  }

  function drawChrome(): void {
    const locale = getLocale()
    document.documentElement.lang = locale
    document.title = t('appTitle')
    picker.value = locale
    picker.setAttribute('aria-label', t('languageLabel'))
    drawFooter()
  }

  function route(): void {
    view?.dispose()
    const framed = deps.isFramed ? deps.isFramed() : window.top !== window.self
    if (framed) {
      view = {
        dispose: () => {},
        draw: () =>
          main.replaceChildren(
            h(
              'div',
              { class: 'stack' },
              h('div', { class: 'lock muted-lock' }, icon('lock')),
              h('h1', {}, t('framedTitle')),
              h('p', { class: 'meta' }, t('framedBody')),
              h(
                'a',
                {
                  class: 'secondary',
                  href: deps.location.href,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
                t('framedOpen'),
              ),
            ),
          ),
      }
    } else if (!deps.api) {
      view = {
        dispose: () => {},
        draw: () =>
          main.replaceChildren(
            h(
              'div',
              { class: 'stack' },
              h('div', { class: 'lock muted-lock' }, icon('lock')),
              h(
                'p',
                { class: 'banner', role: 'alert' },
                icon('alert'),
                h('span', {}, t('errConfig')),
              ),
            ),
          ),
      }
    } else {
      const viewDeps = { api: deps.api, location: deps.location, history: deps.history }
      view = deps.location.hash ? revealView(main, viewDeps) : createView(main, viewDeps)
    }
    view.draw()
  }

  function onHashChange(): void {
    route()
  }

  picker.addEventListener('change', () => {
    if (!isLocale(picker.value)) return
    setLocale(picker.value)
    storeLocale(deps.storage, picker.value)
    drawChrome()
    view?.draw()
  })
  window.addEventListener('hashchange', onHashChange)

  drawChrome()
  route()
  return () => window.removeEventListener('hashchange', onHashChange)
}
