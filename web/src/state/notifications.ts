// Notifications: what happened that you'd want to know about — a song you asked for is
// ready, your take made today's top, a new personal best, a song finished analysing …
// Kept in this browser, per account (a guest has their own list), newest first.
// Each one arrives with a sound and a small card at the top of the screen.

import { useSyncExternalStore } from 'react'
import { sfx, type CueName } from '../lib/sfx'

export type NoteKind =
  | 'song-ready' // a song you asked Lemody to add is in your songs
  | 'request' // your request was received
  | 'analysed' // a song you added finished analysing
  | 'failed' // … or couldn't be analysed
  | 'top' // your take made today's top
  | 'best' // a new personal best on a song
  | 'helped' // you analysed a requested song for everyone
  | 'challenge' // a friend's score to beat
  | 'welcome'
  | 'sync' // your account can't be reached

export interface Note {
  id: string
  /** one notification per key (e.g. "ready:<songId>"): the same news never comes twice */
  key?: string
  kind: NoteKind
  title: string
  body?: string
  at: number
  read: boolean
  /** opens this song when clicked */
  songId?: string
  /** or this page */
  href?: string
}

const SOUND: Record<NoteKind, CueName> = {
  'song-ready': 'receive',
  request: 'send',
  analysed: 'complete',
  failed: 'error',
  top: 'achievement',
  best: 'level-up',
  helped: 'reward',
  challenge: 'mention',
  welcome: 'wake',
  sync: 'warning',
}

const MAX = 60
let owner = 'guest'
let notes: Note[] = load(owner)
/** the newest arrival this visit, shown as a card for a few seconds */
let popup: Note | null = null
let snapshot: { notes: Note[]; popup: Note | null; unread: number } = { notes, popup, unread: count(notes) }
const listeners = new Set<() => void>()

function storageKey(who: string) {
  return `lemo.notes.${who}`
}

function load(who: string): Note[] {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(who)) ?? '[]')
    return Array.isArray(v) ? (v as Note[]) : []
  } catch {
    return []
  }
}

function count(list: Note[]) {
  return list.reduce((n, x) => n + (x.read ? 0 : 1), 0)
}

function commit(next: Note[], save = true) {
  notes = next.slice(0, MAX)
  if (save) {
    try {
      localStorage.setItem(storageKey(owner), JSON.stringify(notes))
    } catch {
      /* storage blocked: kept for this visit */
    }
  }
  snapshot = { notes, popup, unread: count(notes) }
  listeners.forEach((l) => l())
}

let popupTimer: ReturnType<typeof setTimeout> | undefined

export const notifications = {
  /** Switch to someone's own list (on sign in / out). */
  setOwner(who: string | null) {
    const next = who ?? 'guest'
    if (next === owner) return
    owner = next
    popup = null
    commit(load(owner), false)
  },

  /** A new notification (skipped if one with the same key was already given). */
  notify(n: Omit<Note, 'id' | 'at' | 'read'>, opts: { quiet?: boolean } = {}): Note | null {
    if (n.key && notes.some((x) => x.key === n.key)) return null
    const note: Note = { ...n, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), read: false }
    if (!opts.quiet) {
      popup = note
      clearTimeout(popupTimer)
      popupTimer = setTimeout(() => notifications.dismissPopup(note.id), 6000)
      sfx.play(SOUND[n.kind])
    }
    commit([note, ...notes])
    return note
  },

  dismissPopup(id?: string) {
    if (!popup || (id && popup.id !== id)) return
    popup = null
    commit(notes, false)
  },

  markRead(id: string) {
    commit(notes.map((n) => (n.id === id ? { ...n, read: true } : n)))
  },

  markAllRead() {
    if (!count(notes)) return
    commit(notes.map((n) => (n.read ? n : { ...n, read: true })))
  },

  remove(id: string) {
    commit(notes.filter((n) => n.id !== id))
  },

  clear() {
    popup = null
    commit([])
  },

  has(key: string) {
    return notes.some((n) => n.key === key)
  },
}

export function useNotifications() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    () => snapshot,
  )
}

// ---- personal bests (per song, this browser) ----------------------------------------------

const BESTS = 'lemo.bests'

/** A finished test's score (0–1): returns the previous best when this one beats it, else null. */
export function recordScore(songId: string, score: number): number | null {
  let bests: Record<string, number> = {}
  try {
    bests = JSON.parse(localStorage.getItem(BESTS) ?? '{}') ?? {}
  } catch {
    /* fresh */
  }
  const before = bests[songId]
  if (before !== undefined && score <= before) return null
  bests[songId] = score
  try {
    localStorage.setItem(BESTS, JSON.stringify(bests))
  } catch {
    /* blocked */
  }
  // the first score on a song is a start, not a record
  return before !== undefined && score - before >= 0.005 ? before : null
}

// ---- songs you asked Lemody to add ---------------------------------------------------------

type Known = Record<string, string> // songId → title

function knownKey() {
  return `lemo.asked.${owner}`
}
function readKnown(): Known {
  try {
    return JSON.parse(localStorage.getItem(knownKey()) ?? '{}') ?? {}
  } catch {
    return {}
  }
}
function writeKnown(k: Known) {
  try {
    localStorage.setItem(knownKey(), JSON.stringify(k))
  } catch {
    /* blocked */
  }
}

/** You asked for a song: remember it, so its arrival can be announced (here or next visit). */
export function rememberRequest(songId: string, title: string) {
  writeKnown({ ...readKnown(), [songId]: title })
}

/** You cancelled a request: its disappearing isn't news. */
export function forgetRequest(songId: string) {
  const k = readKnown()
  delete k[songId]
  writeKnown(k)
}

/**
 * Compare the requests still waiting with the ones we knew of: any that left the list and
 * are now in your songs have arrived. `pending` from /api/requests, `mine` = your song ids.
 */
export function settleRequests(pending: { songId: string; title: string | null; artist?: string | null }[], mine: Set<string>) {
  const before = readKnown()
  const now: Known = {}
  for (const r of pending) now[r.songId] = r.title || before[r.songId] || 'Your song'
  for (const [id, title] of Object.entries(before)) {
    if (now[id]) continue
    if (!mine.has(id)) {
      now[id] = title // left the list but not in your songs yet (still syncing): look again next time
      continue
    }
    notifications.notify({
      key: `ready:${id}`,
      kind: 'song-ready',
      title: `“${title}” is ready to sing`,
      body: 'The song you asked for was added to Lemody. It’s in your songs now.',
      songId: id,
    })
  }
  writeKnown(now)
}

/** You asked Lemody to add a song: noted, and announced again when it's ready. */
export function noteRequested(r: { id: string; title?: string | null; days?: number }) {
  const title = r.title || 'your song'
  rememberRequest(r.id, title)
  notifications.notify({
    key: `asked:${r.id}`,
    kind: 'request',
    title: `Asked for “${title}”`,
    body: `It’ll be added within ${r.days ? `${r.days} days` : 'a week'}. You’ll get a notification here when it’s ready to sing.`,
    href: '/coming',
  })
}
