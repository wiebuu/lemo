// Songs used to be copied into each browser (IndexedDB, ~2 MB a minute). They now
// live on Lemody's server and VPS, so nothing is stored on the phone. This hands
// any old copies to the server once (if it doesn't have them), keeps them on the
// account's song list, and then frees the space.

import { analyzer } from '../api/analyzer'
import { events } from '../state/events'
import { persist } from '../state/persist'
import type { ReferenceTrack } from './types'

interface OldCopy {
  id: string
  title: string
  artist?: string
  duration: number
  addedAt: number
  reference: ReferenceTrack
  backing: Blob
  vocals: Blob
  owner?: string
}

const DB = 'lemo'
const STORE = 'songs'

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB)
      req.onupgradeneeded = () => {
        // never had one: nothing to move
        req.transaction?.abort()
        resolve(null)
      }
      req.onsuccess = () => resolve(req.result.objectStoreNames.contains(STORE) ? req.result : (req.result.close(), null))
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function all(db: IDBDatabase): Promise<OldCopy[]> {
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as OldCopy[])
    req.onerror = () => resolve([])
  })
}

function drop(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = tx.onerror = tx.onabort = () => resolve()
  })
}

let running: Promise<void> | null = null

/** Once per visit, after sign-in. Copies that can't be handed over yet stay for next time. */
export function moveOldCopiesToServer(): Promise<void> {
  running ??= (async () => {
    const db = await open()
    if (!db) return
    const me = persist.owner()
    let left = 0
    for (const song of await all(db)) {
      if (song.owner && song.owner !== me) {
        left++
        continue // someone else's, from before they signed out on this phone
      }
      try {
        await analyzer.restore(song.id, song.reference, song.backing, song.vocals)
        events.emit('songAdded', { id: song.id, title: song.title, artist: song.artist, duration: song.duration, addedAt: song.addedAt })
        await drop(db, song.id)
      } catch {
        left++ // the server is busy or offline: try again next visit
      }
    }
    db.close()
    if (!left) indexedDB.deleteDatabase(DB)
  })()
  return running
}
