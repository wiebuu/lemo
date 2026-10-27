import { describe, expect, it } from 'vitest'
import { centsBetween, foldOctave, freqToMidi, midiToFreq, midiToNoteName } from './music'

describe('frequency ↔ MIDI', () => {
  it('maps concert pitch references exactly', () => {
    expect(freqToMidi(440)).toBeCloseTo(69, 10)
    expect(freqToMidi(261.6256)).toBeCloseTo(60, 3)
    expect(freqToMidi(880)).toBeCloseTo(81, 10)
    expect(freqToMidi(110)).toBeCloseTo(45, 10)
  })
  it('round-trips', () => {
    for (const m of [36, 48.5, 60, 69.25, 84]) expect(freqToMidi(midiToFreq(m))).toBeCloseTo(m, 9)
  })
  it('names notes', () => {
    expect(midiToNoteName(60)).toBe('C4')
    expect(midiToNoteName(69)).toBe('A4')
    expect(midiToNoteName(61)).toBe('C#4')
    expect(midiToNoteName(47.6)).toBe('C3')
  })
})

describe('cents deviation', () => {
  it('is 0 for identical, +100 one semitone up, +1200 an octave up', () => {
    expect(centsBetween(440, 440)).toBe(0)
    expect(centsBetween(midiToFreq(70), midiToFreq(69))).toBeCloseTo(100, 6)
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 6)
    expect(centsBetween(430, 440)).toBeCloseTo(-39.8, 1)
  })
  it('uses the actual reference, not concert A (a song tuned to A=432)', () => {
    const a432 = 432
    expect(centsBetween(432, a432)).toBe(0)
    expect(centsBetween(440, a432)).toBeCloseTo(31.8, 1)
  })
  it('folds octaves', () => {
    expect(foldOctave(1210)).toEqual({ folded: 10, octaves: 1 })
    expect(foldOctave(-1190).octaves).toBe(-1)
    expect(foldOctave(-1190).folded).toBeCloseTo(10, 9)
    expect(foldOctave(40)).toEqual({ folded: 40, octaves: 0 })
  })
})
