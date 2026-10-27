// A tiny event hub: local saves are announced here, and the account sync
// (cloud.ts) listens — so saving stays synchronous and never waits on the network.

import type { Settings, SongPrefs } from './persist'

export interface SongMeta {
  id: string
  title: string
  artist?: string
  duration: number
  addedAt: number
}

interface Events {
  settingsSaved: [settings: Settings, at: number]
  songSaved: [id: string, prefs: SongPrefs]
  songOpened: [id: string]
  songAdded: [meta: SongMeta]
  songRemoved: [id: string]
}

type Handler<K extends keyof Events> = (...args: Events[K]) => void
// stored loosely; on() / emit() keep each event's arguments typed
const handlers = new Map<keyof Events, Set<(...args: unknown[]) => void>>()

export const events = {
  on<K extends keyof Events>(name: K, fn: Handler<K>): () => void {
    let set = handlers.get(name)
    if (!set) handlers.set(name, (set = new Set()))
    const f = fn as (...args: unknown[]) => void
    set.add(f)
    return () => void set.delete(f)
  },
  emit<K extends keyof Events>(name: K, ...args: Events[K]) {
    handlers.get(name)?.forEach((fn) => {
      try {
        fn(...args)
      } catch (e) {
        console.error('[lemo] event handler failed', name, e)
      }
    })
  },
}
