// Song-time bookkeeping, independent of Web Audio so it can be tested.
//
// Song time is always in *original* song seconds. When playing a slowed-down
// render (speed < 1) the buffer is longer, so bufferTime = songTime / speed.

export interface ClockAnchor {
  /** AudioContext time when playback (re)started. */
  ctxStart: number
  /** Song time at ctxStart. */
  songStart: number
  speed: number
}

export function songTimeAt(anchor: ClockAnchor, ctxTime: number): number {
  return anchor.songStart + (ctxTime - anchor.ctxStart) * anchor.speed
}

export function ctxTimeFor(anchor: ClockAnchor, songTime: number): number {
  return anchor.ctxStart + (songTime - anchor.songStart) / anchor.speed
}

export function clampSeek(t: number, duration: number): number {
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.min(t, Math.max(0, duration - 0.05)))
}

export interface LoopRegion {
  start: number
  end: number
}

/** Where playback should jump when it reaches/passes the loop end, else null. */
export function loopJump(t: number, loop: LoopRegion | null): number | null {
  if (!loop || loop.end - loop.start < 0.2) return null
  return t >= loop.end ? loop.start : null
}

/** A loop region with lead-in so the singer hears the phrase coming. */
export function phraseLoop(start: number, end: number, duration: number, leadIn = 1, tail = 0.4): LoopRegion {
  return { start: Math.max(0, start - leadIn), end: Math.min(duration, end + tail) }
}
