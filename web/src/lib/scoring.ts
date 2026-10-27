// Transparent, testable scoring. Everything here is a pure function of
// (reference notes, user frames, settings) — no audio or UI dependencies.
//
// Rules:
//  - Only notes that are sung, confident enough, and inside the range count.
//  - Note edges (attack/release) are ignored so normal transitions aren't punished.
//  - Silence / unvoiced frames are never "wrong pitch": they lower coverage and
//    accuracy, and a note with too little voice is reported as "missed".
//  - Octave errors (right note class, wrong octave) are reported separately.

import { foldOctave, median } from './music'
import type { NoteResult, NoteStatus, ReferenceNote, ScoreSummary, UserFrame } from './types'

export interface ScoreSettings {
  toleranceCents: number
  minNoteConfidence: number
  /** Semitones the backing track is transposed by; applied to the reference. */
  transpose: number
  /** Below this voiced share a note is "missed". */
  minCoverage: number
}

export const DEFAULT_SCORE: ScoreSettings = {
  toleranceCents: 50,
  minNoteConfidence: 0.5,
  transpose: 0,
  minCoverage: 0.25,
}

export function isScorable(n: ReferenceNote, s: ScoreSettings): boolean {
  return n.sung && n.confidence >= s.minNoteConfidence && n.endTime - n.startTime >= 0.06
}

/** Frames must be sorted by time. Returns index of first frame with t >= time. */
export function lowerBound(frames: { t: number }[], time: number): number {
  let lo = 0, hi = frames.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid].t < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Index of the note sounding at `time`, or -1. Notes must be sorted. */
export function noteAt(notes: ReferenceNote[], time: number): number {
  let lo = 0, hi = notes.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const n = notes[mid]
    if (time < n.startTime) hi = mid - 1
    else if (time >= n.endTime) lo = mid + 1
    else return mid
  }
  return -1
}

export function scoreNote(
  note: ReferenceNote,
  noteIndex: number,
  frames: UserFrame[],
  s: ScoreSettings,
): NoteResult | null {
  const dur = note.endTime - note.startTime
  const edge = Math.min(0.06, dur * 0.2)
  const a = note.startTime + edge
  const b = note.endTime - edge
  const target = note.midiPitch + s.transpose

  let expected = 0
  const inTune: number[] = []
  const devs: number[] = []
  const octaveDevs: number[] = []
  for (let i = lowerBound(frames, a); i < frames.length && frames[i].t < b; i++) {
    expected++
    const m = frames[i].midi
    if (m === null) continue
    const cents = (m - target) * 100
    if (Math.abs(cents) > 600) {
      octaveDevs.push(foldOctave(cents).folded)
    } else {
      devs.push(cents)
      if (Math.abs(cents) <= s.toleranceCents) inTune.push(cents)
    }
  }
  if (expected === 0) return null // user wasn't recording during this note

  const voiced = devs.length + octaveDevs.length
  const coverage = voiced / expected
  const onPitchRatio = voiced ? inTune.length / voiced : 0

  let onsetDelta: number | null = null
  for (let i = lowerBound(frames, note.startTime - 0.3); i < frames.length && frames[i].t < note.endTime; i++) {
    const m = frames[i].midi
    if (m !== null && Math.abs(foldOctave((m - target) * 100).folded) <= s.toleranceCents) {
      onsetDelta = frames[i].t - note.startTime
      break
    }
  }

  let status: NoteStatus
  let cents: number | null = null
  if (coverage < s.minCoverage) {
    status = 'missed'
  } else if (octaveDevs.length > devs.length) {
    status = 'octave'
    cents = median(octaveDevs)
  } else {
    cents = median(devs)
    status = Math.abs(cents) <= s.toleranceCents ? 'hit' : cents > 0 ? 'sharp' : 'flat'
  }
  return { noteIndex, status, cents, coverage, onPitchRatio, onsetDelta }
}

export function scoreRange(
  notes: ReferenceNote[],
  frames: UserFrame[],
  from: number,
  to: number,
  s: ScoreSettings = DEFAULT_SCORE,
): ScoreSummary {
  const results: NoteResult[] = []
  let expectedTotal = 0, voicedTotal = 0, onPitchTotal = 0
  const absDevs: number[] = []
  const onsets: number[] = []

  notes.forEach((n, i) => {
    if (n.startTime < from || n.endTime > to || !isScorable(n, s)) return
    const r = scoreNote(n, i, frames, s)
    if (!r) return
    results.push(r)

    // Frame-level totals (recomputed here so the summary is self-consistent).
    const dur = n.endTime - n.startTime
    const edge = Math.min(0.06, dur * 0.2)
    const target = n.midiPitch + s.transpose
    for (let k = lowerBound(frames, n.startTime + edge); k < frames.length && frames[k].t < n.endTime - edge; k++) {
      expectedTotal++
      const m = frames[k].midi
      if (m === null) continue
      voicedTotal++
      const c = (m - target) * 100
      if (Math.abs(c) <= 600) {
        absDevs.push(Math.abs(c))
        if (Math.abs(c) <= s.toleranceCents) onPitchTotal++
      }
    }
    if (r.onsetDelta !== null) onsets.push(r.onsetDelta * 1000)
  })

  const count = (st: NoteStatus) => results.filter((r) => r.status === st).length
  return {
    from,
    to,
    notesTotal: results.length,
    hit: count('hit'),
    sharp: count('sharp'),
    flat: count('flat'),
    octave: count('octave'),
    missed: count('missed'),
    accuracy: expectedTotal ? onPitchTotal / expectedTotal : 0,
    pitchAccuracy: voicedTotal ? onPitchTotal / voicedTotal : null,
    coverage: expectedTotal ? voicedTotal / expectedTotal : 0,
    medianAbsCents: absDevs.length ? median(absDevs) : null,
    medianOnsetMs: onsets.length ? median(onsets) : null,
    notes: results,
  }
}

// ---- live feedback --------------------------------------------------------

export type LiveState = 'idle' | 'no-voice' | 'listening' | 'on-pitch' | 'sharp' | 'flat' | 'octave'

/**
 * Classify the current moment with hysteresis so vibrato around the tolerance
 * edge doesn't make the label flicker.
 */
export function classifyLive(
  userMidi: number | null,
  targetMidi: number | null,
  tolerance: number,
  prev: LiveState,
): { state: LiveState; cents: number | null } {
  if (userMidi === null) return { state: 'no-voice', cents: null }
  if (targetMidi === null) return { state: 'listening', cents: null }
  const raw = (userMidi - targetMidi) * 100
  if (Math.abs(raw) > 600) return { state: 'octave', cents: foldOctave(raw).folded }
  const band = prev === 'on-pitch' ? tolerance + 8 : tolerance - 4
  if (Math.abs(raw) <= band) return { state: 'on-pitch', cents: raw }
  return { state: raw > 0 ? 'sharp' : 'flat', cents: raw }
}

export function liveLabel(state: LiveState, cents: number | null): string {
  switch (state) {
    case 'idle': return 'ready'
    case 'no-voice': return 'no voice detected'
    case 'listening': return 'listening'
    case 'on-pitch': return 'on pitch'
    case 'octave': return 'octave off'
    case 'sharp': return cents !== null && Math.abs(cents) < 100 ? 'a little sharp' : 'sharp'
    case 'flat': return cents !== null && Math.abs(cents) < 100 ? 'a little flat' : 'flat'
  }
}
