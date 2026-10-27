import { describe, expect, it } from 'vitest'
import { pitchShift, shiftCurve } from './voiceFx'
import type { ReferenceNote, UserFrame } from './types'

const SR = 48000
const tone = (hz: number, secs: number) => Float32Array.from({ length: SR * secs }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR))
/** frequency by zero crossings over the middle second */
const freq = (x: Float32Array) => {
  let c = 0
  for (let i = SR / 2 + 1; i < SR * 1.5; i++) if (x[i - 1] < 0 && x[i] >= 0) c++
  return c
}

describe('pitchShift', () => {
  it('up an octave doubles the pitch, keeps the length', () => {
    const out = pitchShift(tone(220, 2), SR, Float32Array.from([12]))
    expect(out.length).toBe(SR * 2)
    expect(freq(out)).toBeGreaterThan(430)
    expect(freq(out)).toBeLessThan(450)
  })
  it('down 5 semitones', () => {
    const out = pitchShift(tone(440, 2), SR, Float32Array.from([-5]))
    expect(Math.abs(freq(out) - 440 * 2 ** (-5 / 12))).toBeLessThan(6)
  })
  it('no shift returns the take as it was', () => {
    const x = tone(300, 1)
    expect(pitchShift(x, SR, Float32Array.from([0]))).toEqual(x)
  })
  it('a minute of audio renders quickly', () => {
    const x = tone(200, 60)
    const t = performance.now()
    pitchShift(x, SR, Float32Array.from([3]))
    expect(performance.now() - t).toBeLessThan(1500) // ~0.1 s normally; room for a busy machine
  })
})

describe('shiftCurve (tune to the original)', () => {
  const notes: ReferenceNote[] = [{ startTime: 0, endTime: 2, midiPitch: 60, confidence: 1, sung: true }]
  const frames = (midi: number): UserFrame[] => Array.from({ length: 200 }, (_, i) => ({ t: i * 0.01, midi, clarity: 0.9 }))
  const at = (c: Float32Array) => c[150]
  it('pulls a flat note up onto the melody', () =>
    expect(at(shiftCurve(frames(59.5), notes, { start: 0, end: 2, pitch: 0, tune: 1, keyOffset: 0, transpose: 0 }))).toBeCloseTo(0.5, 1))
  it('half strength, half the way', () =>
    expect(at(shiftCurve(frames(59.5), notes, { start: 0, end: 2, pitch: 0, tune: 0.5, keyOffset: 0, transpose: 0 }))).toBeCloseTo(0.25, 1))
  it('in the singer’s own key and octave', () =>
    expect(at(shiftCurve(frames(67.2), notes, { start: 0, end: 2, pitch: 0, tune: 1, keyOffset: -5, transpose: 0 }))).toBeCloseTo(-0.2, 1))
  it('adds the overall pitch shift', () =>
    expect(at(shiftCurve(frames(60), notes, { start: 0, end: 2, pitch: 2, tune: 1, keyOffset: 0, transpose: 0 }))).toBeCloseTo(2, 1))
  it('never pulls more than 3 semitones', () =>
    expect(at(shiftCurve(frames(55), notes, { start: 0, end: 2, pitch: 0, tune: 1, keyOffset: 0, transpose: 0 }))).toBeCloseTo(3, 1))
})
