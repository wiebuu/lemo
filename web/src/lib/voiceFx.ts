// Voice effects for listening back to a take: shift its pitch, and pull it towards
// the original melody ("tune"). Both are done by re-rendering the take — a grain
// pitch shifter that keeps the timing — which takes a fraction of a second in a
// worker. Echo, reverb, tone and volume are live audio nodes (audio/voiceChain.ts).

import type { ReferenceNote, UserFrame } from './types'

export interface VoiceFx {
  /** semitones, −12..12 */
  pitch: number
  /** 0..1: how far each sung note is pulled onto the original melody */
  tune: number
  /** 0..1 */
  echo: number
  /** 0..1 */
  reverb: number
  /** −1 (warm) .. 1 (bright) */
  tone: number
  /** 0..1.5 */
  volume: number
}

export const NO_FX: VoiceFx = { pitch: 0, tune: 0, echo: 0, reverb: 0, tone: 0, volume: 1 }

export const STEP = 0.01 // the curve has one value per 10 ms

/**
 * Semitones to shift the take by at each 10 ms step from `start` (song time):
 * the overall pitch, plus — for "tune" — the distance from what was sung to the
 * original note (in the singer's own key and octave), limited to ±3 semitones so a
 * wrong guess never jumps wildly, and eased so notes glide rather than click.
 */
export function shiftCurve(frames: UserFrame[], notes: ReferenceNote[], opts: {
  start: number
  end: number
  pitch: number
  tune: number
  keyOffset: number | null
  transpose: number
}): Float32Array {
  const n = Math.max(1, Math.ceil((opts.end - opts.start) / STEP))
  const corr = new Float32Array(n)
  if (opts.tune > 0) {
    const sorted = [...notes].sort((a, b) => a.startTime - b.startTime)
    let ni = 0
    const key = opts.keyOffset ?? 0
    const has = new Uint8Array(n)
    for (const f of frames) {
      if (f.midi === null) continue
      const k = Math.round((f.t - opts.start) / STEP)
      if (k < 0 || k >= n) continue
      while (ni < sorted.length - 1 && sorted[ni].endTime < f.t) ni++
      const note = sorted[ni]
      if (!note || note.startTime > f.t || note.endTime < f.t || !note.sung) continue
      const target = note.midiPitch + opts.transpose + key
      const d = target - f.midi
      const folded = d - 12 * Math.round(d / 12) // stay in the octave they sang in
      corr[k] = Math.max(-3, Math.min(3, folded)) * opts.tune
      has[k] = 1
    }
    // hold the last correction over short dropouts (≤ 100 ms), then ease (≈40 ms)
    let last = 0
    let since = Infinity
    for (let k = 0; k < n; k++) {
      if (has[k]) {
        last = corr[k]
        since = 0
      } else if (++since <= 10) corr[k] = last
    }
    const eased = new Float32Array(n)
    let y = corr[0]
    for (let k = 0; k < n; k++) eased[k] = y += (corr[k] - y) * 0.25
    corr.set(eased)
  }
  for (let k = 0; k < n; k++) corr[k] += opts.pitch
  return corr
}

/**
 * Pitch-shift `input` by `semitones[k]` (one value per `step` seconds) and keep its
 * length and timing. Two steps: resample (that changes the pitch — and the length),
 * then put it back on the original timeline with WSOLA: 21 ms grains, each taken
 * from where it lines up best with the one before, so overlapping grains never
 * cancel. Quick: roughly 0.2 s for a minute of audio.
 */
export function pitchShift(input: Float32Array, sampleRate: number, semitones: Float32Array, step = STEP): Float32Array {
  const len = input.length
  if (semitones.every((s) => Math.abs(s) < 1e-3)) return input.slice()
  const ratios = semitones.map((s) => 2 ** (s / 12))
  const perStep = 1 / (sampleRate * step)
  const ratioAt = (pos: number) => ratios[Math.min(ratios.length - 1, Math.round(pos * perStep))]

  // 1. resample: y advances through the input at the shift's rate; tau[t] = where input sample t landed in y
  let maxR = 1
  for (const s of semitones) maxR = Math.min(maxR, 2 ** (s / 12))
  const y = new Float32Array(Math.ceil(len / maxR) + 4096)
  const tau = new Float32Array(len + 1)
  let pos = 0
  let m = 0
  let t = 0
  while (pos < len - 1 && m < y.length) {
    const p0 = Math.floor(pos)
    y[m] = input[p0] + (input[p0 + 1] - input[p0]) * (pos - p0)
    const r = ratioAt(pos)
    const next = pos + r
    while (t <= next && t <= len) {
      tau[t] = m + (t - pos) / r
      t++
    }
    pos = next
    m++
  }
  for (; t <= len; t++) tau[t] = m
  const yLen = m

  // 2. WSOLA back onto the original timing
  const N = 1024
  const H = N / 2
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N) // periodic Hann: halves add up to 1
  const D = Math.round(sampleRate * 0.01) // search ±10 ms (a 100 Hz voice repeats every 10 ms)
  const out = new Float32Array(len)
  const corr = (a: number, b: number, inner: number) => {
    let s = 0
    for (let i = 0; i < H; i += inner) s += y[a + i] * y[b + i]
    return s
  }
  let prev = -1
  for (let c = -H; c < len; c += H) {
    const natural = Math.round(tau[Math.min(len, Math.max(0, c + H))] - H)
    let best = natural
    if (prev >= 0) {
      const ideal = prev + H // what would have followed the previous grain
      const lo = Math.max(0, natural - D)
      const hi = Math.min(yLen - N - 1, natural + D)
      if (ideal >= 0 && ideal + H < yLen && hi > lo) {
        let bestV = -Infinity
        for (let s = lo; s <= hi; s += 6) {
          const v = corr(s, ideal, 8)
          if (v > bestV) {
            bestV = v
            best = s
          }
        }
        const around = best
        for (let s = Math.max(lo, around - 5); s <= Math.min(hi, around + 5); s++) {
          const v = corr(s, ideal, 4)
          if (v > bestV) {
            bestV = v
            best = s
          }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const o = c + i
      const src = best + i
      if (o < 0 || o >= len || src < 0 || src >= yLen) continue
      out[o] += win[i] * y[src]
    }
    prev = best
  }
  return out
}
