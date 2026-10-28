// After a new version of Lemody is deployed, a page that was already open still runs
// the old code, and the parts it loads on demand (lazy screens) no longer exist on the
// server. Reload once to pick up the new version instead of crashing.

const KEY = 'lemo:reloadedForNewVersion'

export function isStaleChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg)
}

/** Reloads the page, unless it already did so in the last 30 s (never a reload loop). */
export function reloadForNewVersion(): boolean {
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
