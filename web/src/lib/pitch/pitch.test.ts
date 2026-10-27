import { describe, expect, it } from 'vitest'
import { centsBetween, freqToMidi } from '../music'
import { harmonicTone, mix, noise, sine } from '../testSignals'
import { PitchTracker } from './tracker'
import { rms, yin } from './yin'

const SR = 48000
const N = 2048

describe('YIN on known test signals', () => {
  it.each([82.41, 110, 196, 261.63, 440, 659.25, 987.77])('detects %f Hz sine within 5 cents', (f) => {
    const est = yin(sine(f, SR, N), { sampleRate: SR })
    expect(est).not.toBeNull()
    expect(Math.abs(centsBetween(est!.freq, f))).toBeLessThan(5)
    expect(est!.clarity).toBeGreaterThan(0.9)
  })

  it('finds the fundamental of a harmonic-rich voice-like tone (no octave error)', () => {
    for (const f of [130.81, 220, 349.23]) {
      const est = yin(harmonicTone(f, SR, N), { sampleRate: SR })
      expect(Math.abs(centsBetween(est!.freq, f))).toBeLessThan(5)
    }
  })

  it('tolerates moderate background noise', () => {
    const est = yin(mix(harmonicTone(220, SR, N, 0.4), noise(N, 0.05)), { sampleRate: SR })
    expect(Math.abs(centsBetween(est!.freq, 220))).toBeLessThan(10)
  })

  it('rejects pure noise', () => {
    expect(yin(noise(N, 0.4, 7), { sampleRate: SR })).toBeNull()
  })

  it('rejects silence', () => {
    expect(yin(new Float32Array(N), { sampleRate: SR })).toBeNull()
  })
})

describe('PitchTracker filtering', () => {
  it('reports silence below the gate and never invents a pitch', () => {
    const t = new PitchTracker()
    const quiet = sine(220, SR, N, 0.001)
    const r = t.push(yin(quiet, { sampleRate: SR }), rms(quiet))
    expect(r.kind).toBe('silence')
    expect(r.midi).toBeNull()
  })

  it('rejects low-confidence frames', () => {
    const t = new PitchTracker({ minClarity: 0.95 })
    const r = t.push({ freq: 220, clarity: 0.6 }, 0.1)
    expect(r.kind).toBe('noise')
    expect(r.midi).toBeNull()
  })

  it('suppresses a single-frame octave blip', () => {
    const t = new PitchTracker()
    t.push({ freq: 220, clarity: 0.95 }, 0.1)
    t.push({ freq: 220, clarity: 0.95 }, 0.1)
    const blip = t.push({ freq: 440, clarity: 0.95 }, 0.1)
    expect(blip.midi!).toBeCloseTo(freqToMidi(220), 1)
  })

  it('follows a real note change immediately', () => {
    const t = new PitchTracker()
    for (let i = 0; i < 4; i++) t.push({ freq: 220, clarity: 0.95 }, 0.1)
    t.push({ freq: 293.66, clarity: 0.95 }, 0.1)
    const r = t.push({ freq: 293.66, clarity: 0.95 }, 0.1)
    expect(r.midi!).toBeCloseTo(62, 1)
  })

  it('bridges a short dropout but breaks the line after holdFrames', () => {
    const t = new PitchTracker({ holdFrames: 2 })
    t.push({ freq: 220, clarity: 0.95 }, 0.1)
    t.push(null, 0.1)
    t.push(null, 0.1)
    t.push(null, 0.1)
    const r = t.push({ freq: 330, clarity: 0.95 }, 0.1)
    expect(r.midi!).toBeCloseTo(freqToMidi(330), 3) // no smoothing from stale note
  })
})

describe('real voices: breathy singing keeps one line, noise stays silent', () => {
  const SR = 48000
  const N = 2048
  let seed = 3
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  const frame = (freq: number, breath: number, k: number) => {
    const b = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const t = (k * 512 + i) / SR
      b[i] = 0.3 * Math.sin(2 * Math.PI * freq * t) + breath * 0.3 * noise()
    }
    return b
  }
  const track = (make: (k: number) => Float32Array, frames = 120) => {
    const tr = new PitchTracker()
    let voiced = 0, breaks = 0, was = false
    for (let k = 0; k < frames; k++) {
      const b = make(k)
      const r = tr.push(yin(b, { sampleRate: SR }), rms(b))
      if (r.midi !== null) voiced++
      if (was && r.midi === null) breaks++
      was = r.midi !== null
    }
    return { voiced: voiced / frames, breaks }
  }

  it('a breathy note (lots of air in the voice) is one unbroken line', () => {
    const r = track((k) => frame(220, 0.55, k))
    expect(r.voiced).toBeGreaterThan(0.9)
    expect(r.breaks).toBeLessThanOrEqual(1)
  })
  it('pure noise (a fan, breath, room) is still not a voice', () => {
    const r = track((k) => frame(220, 0, k).map(() => 0.3 * noise()))
    expect(r.voiced).toBeLessThan(0.05)
  })
})
