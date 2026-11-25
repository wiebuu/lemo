// Google AdSense: which ads may show where, and loading Google's script.
// Ads only ever sit where they don't get in the way (beside the page on big screens,
// at the end of a page, one screen when a song ends) and never while a song is open
// for singing. Everyone chooses in settings → ads: all off, by kind, or by page.

export const AD_CLIENT = 'ca-pub-8049669752168609'

/** AdSense ad units (all responsive display units, one per placement so each can be measured). */
export const AD_SLOTS = {
  side: '9700012490',
  inPage: '1462429821',
  finished: '7872372613',
} as const

/** The kinds of ad. */
export type AdKind = 'side' | 'inPage' | 'finished'
/** The places that can carry ads (beside the page / at its end). */
export type AdPage = 'start' | 'top' | 'profile' | 'coming' | 'guides'

export interface AdPrefs {
  /** false: no ads anywhere, and Google's ad script isn't even loaded */
  on: boolean
  kinds: Record<AdKind, boolean>
  pages: Record<AdPage, boolean>
}

export const DEFAULT_AD_PREFS: AdPrefs = {
  on: true,
  kinds: { side: true, inPage: true, finished: true },
  pages: { start: true, top: true, profile: true, coming: true, guides: true },
}

export const AD_KIND_LABELS: Record<AdKind, string> = {
  side: 'beside the page',
  inPage: 'end of pages',
  finished: 'when a song ends',
}

export const AD_PAGE_LABELS: Record<AdPage, string> = {
  start: 'start screen',
  top: 'today’s top & stats',
  profile: 'profiles',
  coming: 'coming soon',
  guides: 'guides & info pages',
}

/** Saved (or synced) prefs → complete, valid prefs. */
export function cleanAdPrefs(saved: unknown): AdPrefs {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<AdPrefs>
  const bools = <K extends string>(def: Record<K, boolean>, v: unknown) => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    return Object.fromEntries(Object.entries(def).map(([k, d]) => [k, typeof o[k] === 'boolean' ? o[k] : d])) as Record<K, boolean>
  }
  return {
    on: typeof s.on === 'boolean' ? s.on : true,
    kinds: bools(DEFAULT_AD_PREFS.kinds, s.kinds),
    pages: bools(DEFAULT_AD_PREFS.pages, s.pages),
  }
}

/** May this kind of ad show (on this page)? */
export function adAllowed(p: AdPrefs, kind: AdKind, page?: AdPage): boolean {
  return p.on && p.kinds[kind] && (!page || p.pages[page])
}

/** Which page an address belongs to, for ads (undefined: no ads there). */
export function adPageFor(path: string): AdPage | undefined {
  if (path === '/') return 'start'
  if (path === '/top' || path === '/stats') return 'top'
  if (path === '/profile' || path.startsWith('/u/')) return 'profile'
  if (path === '/coming') return 'coming'
  return 'guides'
}

declare global {
  interface Window {
    adsbygoogle?: unknown[] & { loaded?: boolean }
  }
}

const SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`

/** Loads Google's ad script once (index.html already does, unless ads were off at page load). */
export function loadAdScript() {
  if (typeof document === 'undefined' || document.querySelector('script[src*="adsbygoogle.js"]')) return
  const s = document.createElement('script')
  s.async = true
  s.src = SRC
  s.crossOrigin = 'anonymous'
  document.head.appendChild(s)
}

/** Google's ad script has loaded (not blocked by an ad blocker or the network). */
export const adScriptReady = () => typeof window !== 'undefined' && window.adsbygoogle?.loaded === true

// ---- the full-screen ad after a song: not too often

const FINISHED_GAP_MS = 4 * 60_000
const LAST_KEY = 'lemody.ad.finishedAt'

/** At most once every few minutes, so singing song after song isn't interrupted each time. */
export function finishedAdDue(now = Date.now()): boolean {
  try {
    return now - Number(sessionStorage.getItem(LAST_KEY) ?? 0) > FINISHED_GAP_MS
  } catch {
    return true
  }
}

export function markFinishedAd(now = Date.now()) {
  try {
    sessionStorage.setItem(LAST_KEY, String(now))
  } catch {
    /* private mode */
  }
}

/** Ask the app to open settings at the ads tab (from anywhere, e.g. a site page). */
export const openAdSettings = () => window.dispatchEvent(new CustomEvent('lemody:ad-settings'))
