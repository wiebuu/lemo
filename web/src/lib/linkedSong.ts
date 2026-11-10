// A song page's "sing it" link (/?song=yt-…) opens that song. The id is kept until the
// app is up, because signing in comes first and may reload the page.

const KEY = 'lemo.linkedSong'
const BEAT = 'lemo.beat'

/** At startup: keep the linked song (if any) and tidy the address bar. */
export function rememberLinkedSong() {
  try {
    const id = new URLSearchParams(location.search).get('song')
    if (!id || !/^[\w-]{3,64}$/.test(id)) return
    sessionStorage.setItem(KEY, id)
    // a friend's challenge link: the score to beat (0–100)
    const beat = Number(new URLSearchParams(location.search).get('beat'))
    if (beat > 0 && beat <= 100) sessionStorage.setItem(BEAT, beat.toFixed(2))
    else sessionStorage.removeItem(BEAT)
    history.replaceState(null, '', location.pathname)
  } catch {
    // no storage (private window): the link just opens the app
  }
}

/** Once signed in: the song to open, only once. */
export function takeLinkedSong(): string | null {
  try {
    const id = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return id
  } catch {
    return null
  }
}

/** The score a friend's link asks you to beat (e.g. "87.42"), only once. */
export function takeChallenge(): string | null {
  try {
    const v = sessionStorage.getItem(BEAT)
    sessionStorage.removeItem(BEAT)
    return v
  } catch {
    return null
  }
}
