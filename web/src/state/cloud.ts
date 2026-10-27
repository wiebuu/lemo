// Your account's data (settings, your song list, per-song edits & scores), kept in
// the analyzer's local PostgreSQL database. This browser keeps its own copy, so the app stays
// instant and keeps working when the database can't be reached; changes upload in
// the background and the newer copy wins.

import { useSyncExternalStore } from 'react'
import { events, type SongMeta } from './events'
import { persist, type Settings, type SongPrefs } from './persist'
import { moveOldCopiesToServer } from '../lib/localSongs'
import { studio } from './studio'

export type CloudStatus = { state: 'off' | 'syncing' | 'synced' | 'unavailable'; message?: string }

let status: CloudStatus = { state: 'off' }
const listeners = new Set<() => void>()
const setStatus = (s: CloudStatus) => {
  status = s
  listeners.forEach((l) => l())
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
  off = [
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
    setStatus({ state: 'synced' })
    void moveOldCopiesToServer() // songs once kept on this phone: to the server, then the space is freed
  } catch (e) {
    setStatus({ state: 'unavailable', message: (e as Error).message })
  }
}

export function stopCloud() {
  off.forEach((f) => f())
  off = []
  timers.forEach((t) => clearTimeout(t))
  timers.clear()
  accountSongs = []
  setStatus({ state: 'off' })
}
