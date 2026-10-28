// What a pasted link can become: a song file this device can analyse (Google Drive,
// Dropbox, OneDrive, a direct audio link), a song already in Lemody (YouTube), or a
// site that doesn't let anyone use its songs (YouTube, Spotify, …) — then Lemody can
// add it for you instead.

import { youtubeId } from './songSearch'

export type SongLink =
  | { kind: 'youtube'; url: string; videoId: string }
  | { kind: 'file'; url: string; from: string }
  | { kind: 'locked'; url: string; site: string }

const FILE_HOSTS: [RegExp, string][] = [
  [/(^|\.)drive\.google\.com$|^drive\.usercontent\.google\.com$|^docs\.google\.com$/, 'Google Drive'],
  [/(^|\.)dropbox(usercontent)?\.com$/, 'Dropbox'],
  [/^1drv\.ms$|^onedrive\.live\.com$|\.sharepoint\.com$/, 'OneDrive'],
]

const LOCKED: [RegExp, string][] = [
  [/(^|\.)spotify\.com$|^spotify\.link$/, 'Spotify'],
  [/^music\.apple\.com$|^itunes\.apple\.com$/, 'Apple Music'],
  [/(^|\.)jiosaavn\.com$|(^|\.)saavn\.com$/, 'JioSaavn'],
  [/(^|\.)gaana\.com$/, 'Gaana'],
  [/(^|\.)wynk\.in$/, 'Wynk'],
  [/(^|\.)soundcloud\.com$|^on\.soundcloud\.com$/, 'SoundCloud'],
  [/^music\.amazon\.|(^|\.)amazon\.[a-z.]+$/, 'Amazon Music'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)facebook\.com$|^fb\.watch$/, 'Facebook'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)deezer\.com$/, 'Deezer'],
  [/(^|\.)hungama\.com$/, 'Hungama'],
  [/(^|\.)resso\.com$/, 'Resso'],
]

const AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg|opus|webm|mp4)$/i

/** null when the text isn't a link. */
export function songLink(text: string): SongLink | null {
  const s = text.trim()
  if (!/^(https?:\/\/)?[\w-]+(\.[\w-]+)+\/?\S*$/i.test(s) || /\s/.test(s)) return null
  const vid = youtubeId(s)
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`
  if (vid) return { kind: 'youtube', url, videoId: vid }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '')
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return { kind: 'locked', url, site: 'YouTube' }
  for (const [re, from] of FILE_HOSTS) if (re.test(host)) return { kind: 'file', url, from }
  if (AUDIO.test(u.pathname)) return { kind: 'file', url, from: 'a link' }
  for (const [re, site] of LOCKED) if (re.test(host)) return { kind: 'locked', url, site }
  return { kind: 'locked', url, site: host }
}
