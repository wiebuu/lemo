// The library's language filter and sort orders. Pure: every number is precomputed on
// the server (YouTube views from the weekly snapshot, tests started here), so this
// only reorders what's already in memory.

/** featured.json's `lang` codes, as people call them */
export const LANGUAGES: Record<string, string> = {
  hi: 'Hindi', en: 'English', pa: 'Punjabi', hr: 'Haryanvi', gw: 'Garhwali', ur: 'Urdu', ja: 'Japanese', es: 'Spanish',
  fr: 'French', it: 'Italian', de: 'German', id: 'Indonesian', ko: 'Korean', ta: 'Tamil', te: 'Telugu', ru: 'Russian',
  pt: 'Portuguese', ne: 'Nepali', ka: 'Georgian', bn: 'Bengali', mr: 'Marathi', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam',
  zh: 'Chinese', ar: 'Arabic', tr: 'Turkish',
}
export const languageName = (code: string) => LANGUAGES[code] ?? code.toUpperCase()

export interface Counted {
  lang?: string | null
  /** YouTube views (last weekly snapshot) */
  views?: number | null
  /** tests started on it in Lemody */
  sung?: number
  addedAt?: number | null
}

/** Languages that have songs, the most songs first. */
export function languagesIn(items: Pick<Counted, 'lang'>[]): { code: string; name: string; count: number }[] {
  const n = new Map<string, number>()
  for (const it of items) if (it.lang) n.set(it.lang, (n.get(it.lang) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1] || languageName(a[0]).localeCompare(languageName(b[0])))
    .map(([code, count]) => ({ code, name: languageName(code), count }))
}

export type SortOrder = 'popular' | 'sung' | 'lemody'
export const SORTS: { id: SortOrder; label: string; short: string }[] = [
  { id: 'popular', label: 'Most popular', short: 'popular' },
  { id: 'sung', label: 'Most sung on Lemody', short: 'most sung' },
  { id: 'lemody', label: 'Lemody’s order', short: 'Lemody’s order' },
]

/** A new list in this order ('lemody': as it came). Ties: the other number, then the newest. */
export function sortSongs<T extends Counted>(items: T[], order: SortOrder): T[] {
  if (order === 'lemody') return items
  const views = (x: T) => x.views ?? -1
  const sung = (x: T) => x.sung ?? 0
  const newest = (a: T, b: T) => (b.addedAt ?? 0) - (a.addedAt ?? 0)
  return [...items].sort(order === 'popular'
    ? (a, b) => views(b) - views(a) || sung(b) - sung(a) || newest(a, b)
    : (a, b) => sung(b) - sung(a) || views(b) - views(a) || newest(a, b))
}

export const inLanguage = <T extends Pick<Counted, 'lang'>>(items: T[], lang: string | null) => (lang ? items.filter((x) => x.lang === lang) : items)

/** 1234 → "1.2K", 3_400_000 → "3.4M", 2_100_000_000 → "2.1B" */
export function shortCount(n: number): string {
  const f = (v: number, u: string) => `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}${u}`
  if (n >= 1e9) return f(n / 1e9, 'B')
  if (n >= 1e6) return f(n / 1e6, 'M')
  if (n >= 1e3) return f(n / 1e3, 'K')
  return String(n)
}

/** "12M views · 34 sung" — what a song card shows (empty when there's nothing yet). */
export function countsLine(c: Pick<Counted, 'views' | 'sung'>): string {
  return [c.views ? `${shortCount(c.views)} views` : null, c.sung ? `${shortCount(c.sung)} sung` : null].filter(Boolean).join(' · ')
}

/** A YouTube search for a song that isn't in the library yet (its link can then be pasted in). */
export const youtubeSearch = (q: string) => `https://www.youtube.com/results?${new URLSearchParams({ search_query: q.trim() })}`
