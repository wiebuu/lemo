// How your voice line is placed and smoothed for drawing (scoring is unaffected).
// The goal is a line that never jumps: what's drawn stays put, and the line only
// moves where you actually moved.

import type { LineDetail } from '../state/persist'

/**
 * Onto the melody ("shape" view): each moment goes into the octave of the
 * original's note right then — but the octave only changes when you're clearly
 * (more than 7 semitones) away from it, so singing about half an octave off
 * doesn't make the line flip between octaves. A brief pitch-tracker octave slip
 * is still folded back.
 *
 * `anchors[i]`: the melody note at frame i — or every note around then (a fraction
 * of a second either side). On a big leap you never land at the exact instant the
 * melody does; judged against that one note, the frames in between looked an octave
 * off and the line flipped down (or up) for a moment. Close to any of them is fine.
 */
export function placeOnMelody(vals: number[], anchors: (number | number[])[], offset: number): number[] {
  let k: number | null = null
  return vals.map((m, i) => {
    const around = anchors[i]
    const list = typeof around === 'number' ? [around] : around
    const rels = list.map((a) => m - offset - a)
    const fits = (kk: number) => rels.some((r) => Math.abs(r - 12 * kk) <= 7)
    if (k === null || !fits(k)) {
      // the octave that puts you nearest to one of the melody's notes
      let best = rels[0]
      for (const r of rels) if (Math.abs(r - 12 * Math.round(r / 12)) < Math.abs(best - 12 * Math.round(best / 12))) best = r
      k = Math.round(best / 12)
    }
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
  // A slip is brief; a real leap stays. After LEAP frames at the new height the voice is
  // taken to be there (those few frames stay as drawn), instead of folding it down until
  // the median caught up — about a third of a second of the line diving under the note.
  const LEAP = 5
  const out: number[] = []
  let base: number[] = [] // what the median is taken over
  let away: number[] = [] // raw values of the frames folded in a row
  for (let i = 0; i < midis.length; i++) {
    let ref = around
    if (ref === undefined) {
      const prev = base.slice(-40)
      ref = prev.length ? [...prev].sort((a, b) => a - b)[prev.length >> 1] : midis[i]
    }
    const d = midis[i] - ref
    const slip = Math.abs(d) >= 9 && Math.abs(Math.abs(d) - 12) <= 3
    if (slip && around === undefined && away.length + 1 >= LEAP) {
      // it stayed: a real leap. Judge what follows from here.
      base = [...away, midis[i]]
      away = []
      out.push(midis[i])
      continue
    }
    if (slip) away.push(midis[i])
    else away = []
    const v = slip ? midis[i] - 12 * Math.sign(d) : midis[i]
    out.push(v)
    base.push(v)
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

const GLIDE = { smooth: { min: 0.8, beta: 0.05 }, natural: { min: 2.2, beta: 0.05 } } as const
const CONFIRM = 8 // readings (≈ 85 ms) that must agree before a big jump is drawn

/**
 * Your voice line, cleaned for drawing (scoring never sees this). Returns one value per
 * reading, or null for a reading that isn't drawn. Like smoothBack it only looks back,
 * so a point once drawn never changes:
 * - a jump of more than 2.5 semitones is drawn only once ~8 readings (≈ 85 ms) agree on
 *   it — a real move to a new note; a reading that flicks away and back (the tracker
 *   catching a harmonic or the music) is dropped instead of drawn as a vertical stroke;
 * - then a glide filter ("one-euro", as used for smooth cursors): calm and steady on a
 *   held note, quick on a deliberate move.
 * `ended`: the stretch is over (a gap followed), so its fading tail can be trimmed.
 */
export function cleanVoice(vals: number[], detail: LineDetail, ended = false, hz = 94, levels?: (number | undefined)[]): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null)
  const kept: number[] = [] // accepted raw values
  const loud: number[] = [] // levels of the readings drawn so far
  let pending: number[] = []
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]
    // a voice fading out (12 dB under this stretch so far) gives an unreliable pitch:
    // the dive at the end of a note isn't drawn
    const lv = levels?.[i]
    if (lv !== undefined && loud.length >= 8) {
      const ls = loud.slice(-40).sort((a, b) => a - b)
      if (lv < ls[ls.length >> 1] - 12) continue
    }
    if (lv !== undefined) loud.push(lv)
    if (!kept.length) {
      // the line starts once a few readings agree (a stretch can begin on a bad one)
      pending.push(i)
      const pv = pending.map((k) => vals[k])
      if (Math.max(...pv) - Math.min(...pv) > 1.5) pending = pending.slice(1).filter((k) => Math.abs(vals[k] - v) <= 1.5)
      else if (pending.length >= 4) {
        for (const k of pending) {
          kept.push(vals[k])
          out[k] = vals[k]
        }
        pending = []
      }
      continue
    }
    const recent = kept.slice(-5).sort((a, b) => a - b)
    const ref = recent[recent.length >> 1]
    if (Math.abs(v - ref) <= 2.5) {
      pending = [] // a flick that came back: those readings stay undrawn
      kept.push(v)
      out[i] = v
      continue
    }
    pending.push(i)
    const pv = pending.map((k) => vals[k])
    if (Math.max(...pv) - Math.min(...pv) > 1.5) pending = [i] // not settling: start again from here
    else if (pending.length >= CONFIRM) {
      for (const k of pending) {
        kept.push(vals[k])
        out[k] = vals[k]
      }
      pending = []
    }
  }

  // a stretch that's over: trim the tail that dives away as the voice fades
  if (ended) {
    let last = out.length - 1
    while (last >= 0 && out[last] === null) last--
    for (let n = 0; n < 12 && last > 8; n++, last--) {
      const before = out.slice(Math.max(0, last - 16), last).filter((x): x is number => x !== null).sort((a, b) => a - b)
      if (!before.length || Math.abs(out[last]! - before[before.length >> 1]) <= 1.2) break
      out[last] = null
    }
  }

  if (detail === 'detailed') return out
  // the glide filter
  const { min, beta } = GLIDE[detail]
  const dt = 1 / hz
  const alpha = (fc: number) => 1 / (1 + 1 / (2 * Math.PI * fc * dt))
  let x: number | null = null
  let prev = 0 // the previous raw reading: how fast the voice really moves
  let dx = 0
  return out.map((v) => {
    if (v === null) return null
    if (x === null) {
      x = prev = v
      return x
    }
    dx += alpha(1) * ((v - prev) / dt - dx)
    prev = v
    x += alpha(min + beta * Math.abs(dx)) * (v - x)
    return x
  })
}
