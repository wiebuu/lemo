// The site's pages (/about, /help, …) open over the app without reloading it, so a
// song you have open is still there when you come back.

import { useSyncExternalStore, type MouseEvent } from 'react'

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
window.addEventListener('popstate', notify)

export function navigate(to: string) {
  if (to === location.pathname) return
  history.pushState(null, '', to)
  notify()
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
