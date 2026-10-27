// YouTube titles carry a lot besides the song: "ROCKSTAR: Jo Bhi Main 8K Video
// Song | Ranbir Kapoor | A. R. Rahman | Mohit Chauhan". This keeps the song name
// (for display and for finding lyrics) and a sensible artist.

const SEPARATORS = /\s*(?:\||｜|।|—|~|\s-\s)\s*/

const NOISE = [
  /\((?:[^)]*\b(?:official|video|audio|lyrics?|lyrical|visuali[sz]er|vocals? only|hd|4k|8k|remaster(?:ed)?|full song)\b[^)]*)\)/gi,
  /\[(?:[^\]]*\b(?:official|video|audio|lyrics?|lyrical|hd|4k|8k)\b[^\]]*)\]/gi,
  /\b(?:8k|4k|hd|full)?\s*(?:official\s+)?(?:music\s+)?(?:video|audio|lyric(?:al)?)\s*(?:song|video)?\b/gi,
  /\bofficial\b/gi,
  /\bno music\.?/gi,
  /\bwith lyrics\b/gi,
]

/** Parts of a title that name a show, a channel or a label rather than the song. */
const NOT_A_SONG = /\b(?:coke studio|season\s*\d+|episode\s*\d+|ep\.?\s*\d+|t-series|zee music|sony music|saregama|tips official|yrf|unplugged)\b/i
const LABEL = /\b(?:t-series|zee music|sony music|saregama|tips|yrf|coke studio|records|music company|vevo|topic)\b/i

const hasLatin = (s: string) => /[a-z]/i.test(s)
const hasIndic = (s: string) => /[ऀ-ॿ؀-ۿ]/.test(s)

function clean(part: string): string {
  let s = part
  for (const re of NOISE) s = s.replace(re, ' ')
  return s
    .replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** "AASHIQUI 2: Tum Hi Ho" → "Tum Hi Ho": a film / album name before a colon. */
function dropPrefix(s: string): string {
  const m = s.match(/^([^:]{2,30}):\s*(.+)$/)
  return m && m[2].length >= 2 ? m[2] : s
}

function titleCase(s: string): string {
  return s === s.toUpperCase() && hasLatin(s) ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s
}

export function tidyTitle(rawTitle: string, rawArtist?: string | null): { title: string; artist?: string } {
  const parts = rawTitle
    .split(SEPARATORS)
    .map(clean)
    .filter((p) => p && !NOT_A_SONG.test(p))
  if (!parts.length) return { title: rawTitle.trim(), artist: rawArtist ?? undefined }

  // The song name: the first part — or, when it's in Devanagari/Urdu with a
  // romanised version right after it, the romanised one (that's what lyric sites use).
  let ti = 0
  if (hasIndic(parts[0]) && !hasLatin(parts[0]) && parts[1] && hasLatin(parts[1]) && !hasIndic(parts[1])) ti = 1
  const title = dropPrefix(parts[ti])
  const rest = parts.slice(ti + 1)

  let artist = rawArtist?.replace(/\s*-\s*topic$/i, '').trim() || undefined
  if (!artist || LABEL.test(artist)) {
    // the credits after the song name: a part with "&" or "," names the singers; else the last name listed
    artist = rest.find((p) => /&|,| ft\.? | feat\.? /i.test(p)) ?? rest[rest.length - 1] ?? artist
  }
  return { title: titleCase(title) || rawTitle.trim(), artist: artist ? titleCase(artist) : undefined }
}
