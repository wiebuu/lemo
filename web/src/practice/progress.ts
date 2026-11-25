// What the singing course remembers: notation, home note, lessons done (best result each).
// Kept in this browser; when signed in it also goes to your account (state/cloud.ts listens),
// so it follows you to any device. Small on purpose: this file is shared with the main app.

import { defaultNotation, type Notation } from './course'

export interface Progress {
  notation: Notation
  /** home note (Sa / Do / 1) as a MIDI note */
  home: number
  /** done the "find your voice" step */
  voiceSet: boolean
  /** best test result per lesson */
  best: Record<string, { acc: number; stars: number }>
  free: { line: string; hold: number; autoplay: boolean }
  /** when this was last changed (ms) — the newer copy's settings win */
  updatedAt?: number
}

export const COURSE_KEY = 'lemody.course'
/** fired on window after a save here (cloud uploads it) */
export const COURSE_SAVED = 'lemody:course-saved'
/** fired on window when your account's copy arrived (an open course reloads) */
export const COURSE_LOADED = 'lemody:course-loaded'

/** What's stored here, as it is (null when the course was never opened in this browser). */
export function storedProgress(): Partial<Progress> | null {
  try {
    const raw = localStorage.getItem(COURSE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function loadProgress(): Progress {
  const base: Progress = { notation: defaultNotation(), home: 48, voiceSet: false, best: {}, free: { line: '', hold: 1, autoplay: true } }
  return { ...base, ...storedProgress() }
}

/** Save a change made here (stamped now, and sent on to your account when signed in). */
export function saveProgress(p: Progress) {
  const next = { ...p, updatedAt: Date.now() }
  writeProgress(next)
  window.dispatchEvent(new CustomEvent(COURSE_SAVED, { detail: next }))
}

export function writeProgress(p: Partial<Progress>) {
  try {
    localStorage.setItem(COURSE_KEY, JSON.stringify(p))
  } catch {
    /* storage blocked */
  }
}

/**
 * Two copies (this browser's and your account's) into one, losing nothing: every lesson done
 * on either stays done, with the better result; "found your voice" on either counts; the rest
 * (notation, home note, free-practice line) comes from whichever copy changed last.
 */
export function mergeProgress(a: Partial<Progress> | null, b: Partial<Progress> | null): Partial<Progress> {
  if (!a) return b ?? {}
  if (!b) return a
  const [older, newer] = (a.updatedAt ?? 0) > (b.updatedAt ?? 0) ? [b, a] : [a, b]
  const best: Progress['best'] = { ...older.best }
  for (const [id, r] of Object.entries(newer.best ?? {})) {
    const o = best[id]
    best[id] = !o ? r : { stars: Math.max(o.stars, r.stars), acc: Math.max(o.acc, r.acc) }
  }
  return {
    ...older,
    ...newer,
    best,
    voiceSet: !!(older.voiceSet || newer.voiceSet),
    updatedAt: Math.max(older.updatedAt ?? 0, newer.updatedAt ?? 0),
  }
}
