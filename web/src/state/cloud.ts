// Your account's data (settings, your song list, per-song edits & scores), kept in
// the analyzer's local PostgreSQL database. This browser keeps its own copy, so the app stays
// instant and keeps working when the database can't be reached; changes upload in
// the background and the newer copy wins.

import { useSyncExternalStore } from 'react'
import { events, type SongMeta } from './events'
import { persist, type Settings, type SongPrefs } from './persist'
import { moveOldCopiesToServer } from '../lib/localSongs'
import { studio } from './studio'
import { clearLikes, loadLikes } from './library'
import { COURSE_LOADED, COURSE_SAVED, mergeProgress, storedProgress, writeProgress, type Progress } from '../practice/progress'

export type CloudStatus = { state: 'off' | 'syncing' | 'synced' | 'unavailable'; message?: string }

let status: CloudStatus = { state: 'off' }
const listeners = new Set<() => void>()
const setStatus = (s: CloudStatus) => {
  status = s
  listeners.forEach((l) => l())
}

export const cloudStatus = () => status
export function subscribeCloud(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function useCloud(): CloudStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    () => status,
  )
}

/** Your songs, from any device (names only — the audio lives on Lemody's server). */
let accountSongs: SongMeta[] = []
export const cloudSongs = () => accountSongs

async function call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  const res = await fetch(`/api/me${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 404) return null
  if (!res.ok) {
    let msg = `${res.status}`
    try {
      msg = (await res.json()).detail ?? msg
    } catch {
      /* not json */
    }
    throw new Error(msg)
  }
  return (await res.json()) as T
}

// ---- uploads (debounced; the newest local copy is what goes up) -----------------------------

const timers = new Map<string, ReturnType<typeof setTimeout>>()
function later(key: string, ms: number, fn: () => Promise<unknown>) {
  clearTimeout(timers.get(key))
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      if (status.state === 'off') return
      setStatus({ state: 'syncing' })
      fn()
        .then(() => setStatus({ state: 'synced' }))
        .catch((e: Error) => setStatus({ state: 'unavailable', message: e.message }))
    }, ms),
  )
}

const pushSettings = (s: Settings, at: number) => later('settings', 1500, () => call('PUT', '/settings', { settings: s, updatedAt: at }))
const pushPrefs = (id: string, prefs: SongPrefs) =>
  later(`prefs:${id}`, 2000, () => call('PUT', `/prefs/${encodeURIComponent(id)}`, { prefs, updatedAt: prefs.updatedAt ?? Date.now() }))

// The singing course's progress, kept with your account like one more saved document.
const COURSE_DOC = `/prefs/${encodeURIComponent('app:course')}`
const pushCourse = (p: Partial<Progress>) => later('course', 1500, () => call('PUT', COURSE_DOC, { prefs: p, updatedAt: p.updatedAt ?? Date.now() }))

/** On sign-in: this browser's progress and your account's, merged (nothing done on either is lost). */
async function syncCourse() {
  try {
    const r = await call<{ prefs: Partial<Progress>; updatedAt: number }>('GET', COURSE_DOC)
    const local = storedProgress()
    const remote = r ? { ...r.prefs, updatedAt: r.updatedAt } : null
    const merged = mergeProgress(local, remote)
    if (!remote && !local) return
    if (JSON.stringify(merged) !== JSON.stringify(local)) {
      writeProgress(merged)
      window.dispatchEvent(new Event(COURSE_LOADED))
    }
    // the account is missing something this browser has: send the merged copy (stamped now, so it's taken)
    if (!remote || JSON.stringify(merged) !== JSON.stringify(remote)) {
      const next = { ...merged, updatedAt: Math.max(Date.now(), (merged.updatedAt ?? 0) + 1) }
      writeProgress(next)
      pushCourse(next)
    }
  } catch {
    /* offline: the local copy is used, and goes up with the next change */
  }
}

/** Opening the course: pick up progress made on another device since this one signed in. */
export function syncCourseNow() {
  if (status.state !== 'off') void syncCourse()
}

// ---- downloads ---------------------------------------------------------------------------

/** On opening a song: take your account's copy of its data if it's newer than this browser's. */
async function pullPrefs(id: string) {
  if (status.state === 'off') return
  try {
    const r = await call<{ prefs: SongPrefs; updatedAt: number }>('GET', `/prefs/${encodeURIComponent(id)}`)
    const local = persist.song(id)
    if (r && r.updatedAt > (local.updatedAt ?? 0)) studio.applyCloudPrefs(id, { ...r.prefs, updatedAt: r.updatedAt })
    else if (!r && local.updatedAt) pushPrefs(id, local) // never uploaded yet
  } catch {
    /* offline: the local copy is used */
  }
}

// ---- start / stop --------------------------------------------------------------------------

let off: (() => void)[] = []

/** Called when someone signs in (and on every app start while signed in). */
export async function startCloud(uid: string) {
  stopCloud()
  const previous = persist.owner()
  if (previous && previous !== uid) persist.clearUserData() // someone else's data: theirs is safe in their account
  persist.setOwner(uid)

  setStatus({ state: 'syncing' })
  void loadLikes()
  const onCourse = (e: Event) => pushCourse((e as CustomEvent<Progress>).detail)
  window.addEventListener(COURSE_SAVED, onCourse)
  off = [
    () => window.removeEventListener(COURSE_SAVED, onCourse),
    events.on('settingsSaved', pushSettings),
    events.on('songSaved', pushPrefs),
    events.on('songOpened', (id) => void pullPrefs(id)),
    events.on('songAdded', (meta) => {
      accountSongs = [meta, ...accountSongs.filter((s) => s.id !== meta.id)]
      later(`song:${meta.id}`, 300, () => call('PUT', `/songs/${encodeURIComponent(meta.id)}`, meta))
    }),
    events.on('songRemoved', (id) => {
      accountSongs = accountSongs.filter((s) => s.id !== id)
      later(`song:${id}`, 300, () => call('DELETE', `/songs/${encodeURIComponent(id)}`))
    }),
  ]
  try {
    const me = await call<{ settings: Partial<Settings> | null; settingsUpdatedAt: number; songs: (SongMeta & { songId?: string })[] }>('GET', '')
    if (!me) throw new Error('no account data')
    accountSongs = me.songs.map((s) => ({ ...s, id: s.id ?? s.songId! }))
    const localAt = persist.settingsAt()
    if (me.settings && me.settingsUpdatedAt > localAt) studio.applyCloudSettings(me.settings, me.settingsUpdatedAt)
    else if (localAt > me.settingsUpdatedAt) pushSettings(persist.settings(), localAt)
    if (studio.snap.track) void pullPrefs(studio.snap.track.id)
    void syncCourse()
    setStatus({ state: 'synced' })
    void moveOldCopiesToServer() // songs once kept on this phone: to the server, then the space is freed
  } catch (e) {
    setStatus({ state: 'unavailable', message: (e as Error).message })
  }
}

/** Songs added to your list from elsewhere (a song you asked Lemody to add is ready). */
export async function refreshCloudSongs() {
  try {
    const me = await call<{ songs: (SongMeta & { songId?: string })[] }>('GET', '')
    if (me) accountSongs = me.songs.map((s) => ({ ...s, id: s.id ?? s.songId! }))
  } catch {
    /* next time */
  }
}

export function stopCloud() {
  off.forEach((f) => f())
  off = []
  timers.forEach((t) => clearTimeout(t))
  timers.clear()
  accountSongs = []
  clearLikes()
  setStatus({ state: 'off' })
}
