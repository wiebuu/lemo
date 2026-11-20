// After a new version of Lemody is deployed, a page that was already open still runs
// the old code, and the parts it loads on demand (lazy screens) no longer exist on the
// server. Reload once to pick up the new version instead of crashing.

const KEY = 'lemo:reloadedForNewVersion'

export function isStaleChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg)
}

/** Something on the page that a reload would lose (an open song, a test's results). */
let keepPage: () => boolean = () => false
let onKept: () => void = () => {}
export function setKeepPage(keep: () => boolean, kept: () => void) {
  keepPage = keep
  onKept = kept
}

/**
 * Reloads the page, unless it already did so in the last 30 s (never a reload loop),
 * or a reload would lose what you're doing (then: a note to reload when you're ready).
 */
export function reloadForNewVersion(): boolean {
  if (keepPage()) {
    onKept()
    return false
  }
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* storage blocked: still reload once */
  }
  location.reload()
  return true
}

export function installStaleBuildReload() {
  // Vite's signal that a lazy part of the app couldn't be loaded
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadForNewVersion()) e.preventDefault()
  })
}

// ---- the on-demand parts, fetched early -------------------------------------------------------
// Each deploy replaces them (new file names), so a page opened before it could no longer
// load one it hadn't used yet (e.g. voice effects on a test's results). Fetched quietly
// soon after the page opens, they stay with the page whatever is deployed later.

const parts: (() => Promise<unknown>)[] = []

/** Fetch this import in the background a few seconds after the page loads. */
export function prefetch<T>(load: () => Promise<T>): () => Promise<T> {
  parts.push(load)
  return load
}

/**
 * A lazy screen's import, fetched early. If it still can't load (an update came first) while
 * something is open that a reload would lose, it just doesn't open, and a note says to reload.
 */
export function early<T>(load: () => Promise<T>): () => Promise<T> {
  parts.push(load)
  return () =>
    load().catch((e) => {
      if (!isStaleChunkError(e) || !keepPage()) throw e
      onKept()
      return new Promise<T>(() => {}) // stays unopened (its Suspense shows nothing)
    })
}

export function fetchPartsEarly() {
  const go = () => parts.forEach((load) => void load().catch(() => {}))
  const idle = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  const later = () => (idle ? idle(go, { timeout: 4000 }) : setTimeout(go, 1500))
  if (document.readyState === 'complete') setTimeout(later, 2500)
  else window.addEventListener('load', () => setTimeout(later, 2500), { once: true })
}
