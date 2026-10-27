import { describe, expect, it } from 'vitest'
import { foldOctaveSlips, placeOnMelody, runStart, smoothBack } from './voiceLine'

describe('placeOnMelody', () => {
  it('does not flip octaves when singing about half an octave away', () => {
    // melody on 60; the singer wavers around 66 (±0.4): plain rounding would flip between 66 and 54
    const vals = [65.7, 66.3, 65.8, 66.4, 65.9, 66.2]
    // drawn where sung: nothing gets moved by an octave
    expect(placeOnMelody(vals, vals.map(() => 60), 0)).toEqual(vals)
  })
  it('still folds a brief octave slip back', () => {
    const vals = [60, 60.2, 72.1, 60.1, 60]
    expect(placeOnMelody(vals, vals.map(() => 60), 0).map(Math.round)).toEqual([60, 60, 60, 60, 60])
  })
  it('removes the key offset (singing in another key lands on the melody)', () => {
    const out = placeOnMelody([57, 59, 57], [60, 62, 60], -3)
    expect(out).toEqual([60, 62, 60])
  })
})

describe('smoothBack', () => {
  it('never changes points already drawn when new pitch arrives', () => {
    const a = [60, 60.5, 59.8, 61, 60.2, 60.4, 59.9, 60.7]
    const before = smoothBack(a.slice(0, 6), 'smooth')
    const after = smoothBack(a, 'smooth').slice(0, 6)
    expect(after).toEqual(before)
  })
  it('keeps detailed as heard', () => {
    expect(smoothBack([60, 61, 60], 'detailed')).toEqual([60, 61, 60])
  })
})

describe('foldOctaveSlips', () => {
  it('folds values about an octave away back next to the voice', () => {
    const out = foldOctaveSlips([60, 72.4, 61, 47.8, 63], 61)
    ;[60, 60.4, 61, 59.8, 63].forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6))
  })
  it('leaves real intervals inside the octave alone', () => {
    expect(foldOctaveSlips([60, 67, 55, 68], 61)).toEqual([60, 67, 55, 68])
  })
})

describe('runStart (the past line keeps still while scrolling)', () => {
  const f = (t: number, midi: number | null) => ({ t, midi })
  const frames = [f(0, 60), f(0.01, 60), f(0.02, 60), f(0.5, 64), f(0.51, 64), f(0.52, null), f(0.53, 64), f(0.54, 64), f(0.6, 70)]
  it('walks back to where the stretch begins', () => expect(runStart(frames, 7)).toBe(3))
  it('crosses a short dropout', () => expect(runStart(frames, 6)).toBe(3))
  it('stops at a long gap', () => expect(runStart(frames, 4)).toBe(3))
  it('a leap starts a new stretch', () => expect(runStart(frames, 8)).toBe(8))
  it('first frame of a stretch stays put', () => expect(runStart(frames, 2)).toBe(0))
})
