import { describe, expect, it } from 'vitest'
import { levelTake, takeGain } from './level'

const sine = (amp: number, seconds = 2, sr = 16000) =>
  Float32Array.from({ length: seconds * sr }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / sr))

const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length)

describe('your take, levelled for listening back', () => {
  it('a quiet take is brought up to singing level', () => {
    const out = levelTake(sine(0.02))
    expect(rms(out)).toBeGreaterThan(0.1)
    expect(rms(out)).toBeLessThan(0.14)
  })
  it('a loud take is left as it is', () => expect(takeGain(sine(0.3))).toBe(1))
  it('never clips', () => {
    const loud = sine(0.02)
    loud[1000] = 0.5 // a sudden loud moment, far above the rest
    expect(Math.max(...levelTake(loud).map(Math.abs))).toBeLessThan(1)
  })
  it('silence stays silence (no noise pumped up)', () => expect(takeGain(new Float32Array(32000))).toBe(1))
  it('the boost has a limit', () => expect(takeGain(sine(0.001))).toBe(12))
})
