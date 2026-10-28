// How your voice line is placed and smoothed for drawing (scoring is unaffected).
// The goal is a line that never jumps: what's drawn stays put, and the line only
// moves where you actually moved.

import type { LineDetail } from '../state/persist'

/**
 * Onto the melody ("shape" view): each moment goes into the octave of the
 * original's note right then — but the octave only changes when you're clearly
 * (more than 7 semitones) away from it, so singing about half an octave off
 * doesn't make the line flip between octaves. A brief pitch-tracker octave slip
 * is still folded back. `anchors[i]`: the melody note at frame i.
 */
export function placeOnMelody(vals: number[], anchors: number[], offset: number): number[] {
  let k: number | null = null
  return vals.map((m, i) => {
    const rel = m - offset - anchors[i]
    if (k === null || Math.abs(rel - 12 * k) > 7) k = Math.round(rel / 12)
    return m - offset - 12 * k
  })
}

/**
 * Pitch-tracker octave slips: values about an octave from `around` are folded back.
 * Real octave leaps are rare and brief in singing; slips are common.
 */
export function foldOctaveSlips(midis: number[], around?: number): number[] {
  // Each frame is judged against the frames before it (their median), never later ones:
  // a stretch still being sung grows, and a judgement that used the whole stretch made
  // the part already drawn jump an octave mid-song. `around` (fixed) is used when given.
  const out: number[] = []
  for (let i = 0; i < midis.length; i++) {
    let ref = around
    if (ref === undefined) {
      const prev = out.slice(Math.max(0, i - 40), i)
      ref = prev.length ? [...prev].sort((a, b) => a - b)[prev.length >> 1] : midis[i]
    }
    const d = midis[i] - ref
    out.push(Math.abs(d) >= 9 && Math.abs(Math.abs(d) - 12) <= 3 ? midis[i] - 12 * Math.sign(d) : midis[i])
  }
  return out
}

/** How many frames smoothBack lags behind: draw point i at frame i − this, so timing stays true. */
export const smoothDelay = (detail: LineDetail) => (detail === 'smooth' ? 6 : detail === 'natural' ? 2 : 0)

/**
 * Smoothing that only looks back in time: a point, once drawn, never changes as
 * new pitch arrives — so the tip of the line doesn't wiggle while you sing.
 * smooth ≈ 90 ms, natural ≈ 30 ms, detailed = as heard.
 */
export function smoothBack(vals: number[], detail: LineDetail): number[] {
  if (detail === 'detailed') return vals
  const mw = detail === 'smooth' ? 5 : 3 // median: drops single-frame blips
  const aw = detail === 'smooth' ? 9 : 3 // then a moving average
  const med = vals.map((_, i) => {
    const w = vals.slice(Math.max(0, i - mw + 1), i + 1).sort((a, b) => a - b)
    return w[w.length >> 1]
  })
  return med.map((_, i) => {
    const a = Math.max(0, i - aw + 1)
    let s = 0
    for (let k = a; k <= i; k++) s += med[k]
    return s / (i - a + 1)
  })
}

/**
 * Where the stretch of singing that contains frame `i` really starts. The graph must
 * draw a stretch from its own start, not from the screen's left edge: the octave
 * placement and the smoothing both depend on the first frames, so cutting the
 * stretch at the edge — which moves every frame as it scrolls — made the past line
 * jump up and down. (Same gap rules as the drawing: ≤ 0.15 s, no leap > 2.5 st.)
 */
export function runStart(frames: { t: number; midi: number | null }[], i: number, maxBack = 30): number {
  let j = Math.min(i, frames.length)
  let after: { t: number; midi: number } | null = null
  for (let k = j; k < frames.length; k++) {
    const f = frames[k]
    if (f.midi !== null) {
      after = { t: f.t, midi: f.midi }
      break
    }
  }
  if (!after) return j
  const limit = after.t - maxBack
  while (j > 0) {
    const f = frames[j - 1]
    if (f.t < limit) break
    if (f.midi === null) {
      if (after.t - f.t > 0.15) break
      j--
      continue
    }
    const dt = after.t - f.t
    if (dt > 0.15 || (dt > 0.03 && Math.abs(after.midi - f.midi) > 2.5)) break
    after = { t: f.t, midi: f.midi }
    j--
  }
  return j
}
