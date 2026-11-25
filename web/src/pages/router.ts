// The site's pages (/about, /help, …) open over the app without reloading it, so a
// song you have open is still there when you come back.

import { useSyncExternalStore, type MouseEvent } from 'react'
import { sfx } from '../lib/sfx'

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
window.addEventListener('popstate', () => {
  sfx.play('back', { volume: 0.7 })
  notify()
})

export function navigate(to: string) {
  if (to === location.pathname) return
  // how many pages deep inside Lemody (so "back" knows whether there's a Lemody page to go back to)
  history.pushState({ depth: depth() + 1 }, '', to)
  sfx.play(to === '/' ? 'back' : 'forward', { volume: 0.7 })
  notify()
}

const depth = (): number => (history.state as { depth?: number } | null)?.depth ?? 0

/** Back a page — or, when this page was opened straight from outside (a link, a search), to Lemody's home. */
export function back() {
  if (depth() > 0) history.back()
  else navigate('/')
}

export function usePath(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => location.pathname,
  )
}

/** onClick for an internal <a href="/…">: opens the page in place (new-tab clicks work as usual). */
export function go(e: MouseEvent<HTMLAnchorElement>) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  navigate(e.currentTarget.getAttribute('href') ?? '/')
  window.scrollTo(0, 0)
}
