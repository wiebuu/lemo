// The library everyone shares (every stored song, with its play counts) and the songs
// you liked. The song list is fetched by the start page and kept here, so the player can
// show a song's counts without asking again.

import { useEffect, useSyncExternalStore } from 'react'
import { analyzer, type CatalogItem } from '../api/analyzer'
import { signedIn, signInWithGoogle } from '../auth/firebase'

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

// ---- every song, with its counts ------------------------------------------------------------

let songs: CatalogItem[] = []
let byId = new Map<string, CatalogItem>()
let fetching: Promise<void> | null = null

export function setCatalog(list: CatalogItem[]) {
  songs = list
  byId = new Map(list.map((c) => [c.id, c]))
  changed()
}

/** One song's entry (views, times sung); fetches the list once if nothing has yet. */
export function useSong(id: string | null | undefined): CatalogItem | undefined {
  const map = useSyncExternalStore(subscribe, () => byId)
  useEffect(() => {
    if (id && !songs.length && !fetching) fetching = analyzer.catalog().then(setCatalog, () => void (fetching = null))
  }, [id])
  return id ? map.get(id) : undefined
}

// ---- liked songs ---------------------------------------------------------------------------

/** your liked songs' ids, the newest first */
let liked: string[] = []
/** a guest pressed ♥: they're asked to sign in (and that song is liked once they have) */
let asking = false
let pending: string | null = null

type Likes = { ids: string[]; asking: boolean }
let snap: Likes = { ids: liked, asking }
const publish = () => {
  snap = { ids: liked, asking }
  changed()
}

export function useLikes(): Likes {
  return useSyncExternalStore(subscribe, () => snap)
}

/** At sign-in (and every start while signed in). */
export async function loadLikes() {
  try {
    liked = await fetch('/api/me/likes').then((r) => (r.ok ? (r.json() as Promise<string[]>) : Promise.reject(new Error(String(r.status)))))
    publish()
  } catch {
    /* offline: the heart just shows empty */
  }
}

export function clearLikes() {
  liked = []
  publish()
}

/** ♥ on a song: liked ↔ not. Shown at once; put back if the server says no. */
export async function toggleLike(id: string) {
  if (!signedIn()) {
    asking = true
    pending = id
    return publish()
  }
  const was = liked.includes(id)
  liked = was ? liked.filter((x) => x !== id) : [id, ...liked]
  publish()
  const res = await fetch(`/api/me/likes/${encodeURIComponent(id)}`, { method: was ? 'DELETE' : 'PUT' }).catch(() => null)
  if (!res?.ok) {
    liked = was ? [id, ...liked.filter((x) => x !== id)] : liked.filter((x) => x !== id)
    publish()
  }
}

export function closeAsk() {
  asking = false
  pending = null
  publish()
}

export async function signInToLike() {
  const id = pending
  await signInWithGoogle()
  if (!signedIn()) return
  closeAsk()
  if (id) await fetch(`/api/me/likes/${encodeURIComponent(id)}`, { method: 'PUT' }).catch(() => null)
  await loadLikes()
}
