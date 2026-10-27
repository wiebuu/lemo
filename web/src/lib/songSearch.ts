// Finding a stored song by its name or its singer, the way people type it:
// any case, accents or punctuation, words in any order, a word half-typed.

import { tidyTitle } from './titles'

export interface Searchable {
  id: string
  title: string
  artist?: string | null
}

export type Found<T> = T & { shownTitle: string; shownArtist?: string }

export const YOUTUBE_LINK = /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com\/(watch\?.*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w-]{11}/i

/** The video id in a YouTube link, or null. */
export function youtubeId(text: string): string | null {
  const s = text.trim()
  if (!YOUTUBE_LINK.test(s)) return null
  const m = s.match(/(?:v=|shorts\/|live\/|embed\/|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Songs matching every word typed, best first (a title that starts with it beats a singer match). */
export function searchSongs<T extends Searchable>(items: T[], query: string, limit = 8): Found<T>[] {
  const words = norm(query).split(' ').filter(Boolean)
  if (!words.length) return []
  const out: { item: Found<T>; score: number }[] = []
  for (const it of items) {
    const t = tidyTitle(it.title, it.artist)
    const title = norm(t.title)
    const artist = norm(t.artist ?? it.artist ?? '')
    const all = `${title} ${artist} ${norm(it.title)}`
    const tokens = all.split(' ')
    if (!words.every((w) => tokens.some((tok) => tok.startsWith(w)))) continue
    const q = words.join(' ')
    const score =
      (title === q ? 100 : 0) +
      (title.startsWith(q) ? 50 : 0) +
      (artist.startsWith(q) ? 30 : 0) +
      words.filter((w) => title.split(' ').some((tok) => tok.startsWith(w))).length * 5
    out.push({ item: { ...it, shownTitle: t.title, shownArtist: t.artist }, score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map((o) => o.item)
}
