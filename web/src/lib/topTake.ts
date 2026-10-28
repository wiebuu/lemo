// A take sent to today's top: the voice as a small WAV and the pitch line as compact
// lists. Opening one from the board turns them back into a take.

import type { UserFrame } from './types'

/** What a take needs to count: a song from the library, a minute of it, normal speed and the original key. */
export const TOP_MIN_SECONDS = 60
export const TOP_RATE = 22050

const r = (v: number, d: number) => Math.round(v * d) / d

export interface PackedFrames {
  t: number[]
  m: (number | null)[]
  c: number[]
  l: (number | null)[]
}

export function packFrames(frames: UserFrame[]): PackedFrames {
  return {
    t: frames.map((f) => r(f.t, 1000)),
    m: frames.map((f) => (f.midi === null ? null : r(f.midi, 100))),
    c: frames.map((f) => r(f.clarity, 100)),
    l: frames.map((f) => (f.level === undefined ? null : r(f.level, 10))),
  }
}

export function unpackFrames(p: { t: number[]; m: (number | null)[]; c: number[]; l?: (number | null)[] }): UserFrame[] {
  return p.t.map((t, i) => {
    const f: UserFrame = { t, midi: p.m[i] ?? null, clarity: p.c[i] ?? 0 }
    const l = p.l?.[i]
    if (l !== null && l !== undefined) f.level = l
    return f
  })
}

/** Down to `rate` (averaging the samples each output sample spans, so it doesn't alias), as 16-bit mono WAV. */
export function wavOf(samples: Float32Array, sampleRate: number, rate = TOP_RATE): Blob {
  const step = sampleRate / rate
  const n = Math.floor((samples.length * rate) / sampleRate + 1e-9)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step)
    const b = Math.max(a + 1, Math.min(samples.length, Math.floor((i + 1) * step)))
    let sum = 0
    for (let j = a; j < b; j++) sum += samples[j]
    const v = Math.max(-1, Math.min(1, sum / (b - a)))
    out[i] = Math.round(v * 32767)
  }
  const head = new DataView(new ArrayBuffer(44))
  const text = (o: number, s: string) => [...s].forEach((ch, k) => head.setUint8(o + k, ch.charCodeAt(0)))
  text(0, 'RIFF')
  head.setUint32(4, 36 + out.byteLength, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  head.setUint32(16, 16, true)
  head.setUint16(20, 1, true) // PCM
  head.setUint16(22, 1, true) // mono
  head.setUint32(24, rate, true)
  head.setUint32(28, rate * 2, true)
  head.setUint16(32, 2, true)
  head.setUint16(34, 16, true)
  text(36, 'data')
  head.setUint32(40, out.byteLength, true)
  return new Blob([head.buffer, out.buffer], { type: 'audio/wav' })
}
