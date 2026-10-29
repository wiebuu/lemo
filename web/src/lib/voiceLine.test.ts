import { describe, expect, it } from 'vitest'
import { cleanVoice, foldOctaveSlips, placeOnMelody, runStart, smoothBack } from './voiceLine'

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
  it('a big leap a moment early or late never flips the line an octave', () => {
    // the melody leaps 60 → 70 at frame 4; the singer gets there two frames early,
    // then sings it. Against the note at each instant, frames 2–3 looked an octave off.
    const vals = [60, 60, 70, 70, 70, 70, 70]
    const atInstant = [60, 60, 60, 60, 70, 70, 70]
    const around = [[60], [60, 70], [60, 70], [60, 70], [60, 70], [70], [70]]
    expect(placeOnMelody(vals, atInstant, 0)).toEqual([60, 60, 58, 58, 70, 70, 70]) // the dip it used to draw
    expect(placeOnMelody(vals, around, 0)).toEqual(vals)
    // and late: still on the old note when the melody has already leapt
    expect(placeOnMelody([60, 60, 60, 70, 70], [[60], [60, 70], [60, 70], [60, 70], [70]], 0)).toEqual([60, 60, 60, 70, 70])
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
  it('a line already drawn never changes as more singing arrives', () => {
    // a long stretch that starts low and climbs: judged against the whole stretch, the
    // first notes would flip an octave once the high part arrived
    const sung = [55, 55.2, 55.1, 67.3, 56, 58, 60, 62, 64, 66, 67, 68, 69, 70, 71, 72, 72.2]
    const early = foldOctaveSlips(sung.slice(0, 6))
    const later = foldOctaveSlips(sung)
    expect(later.slice(0, 6)).toEqual(early)
    expect(early[3]).toBeCloseTo(55.3) // the one-frame octave slip is still folded down
  })

  it('folds values about an octave away back next to the voice', () => {
    const out = foldOctaveSlips([60, 72.4, 61, 47.8, 63], 61)
    ;[60, 60.4, 61, 59.8, 63].forEach((v, i) => expect(out[i]).toBeCloseTo(v, 6))
  })
  it('a real leap of nearly an octave is followed after a few frames, not folded for long', () => {
    const sung = [...Array(30).fill(60), ...Array(20).fill(70.5)]
    const out = foldOctaveSlips(sung)
    expect(out.slice(0, 30)).toEqual(sung.slice(0, 30))
    expect(out.slice(34)).toEqual(sung.slice(34)) // from the 5th frame up there, drawn where sung
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

describe('cleanVoice: the voice line as drawn', () => {
  const held = (m: number, n: number) => Array.from({ length: n }, () => m)
  it('a flick to a far note and back is dropped, not drawn as a spike', () => {
    const vals = [...held(60, 20), 72, 71.8, 72.2, 72, 71.9, 72.1, 72, ...held(60, 20)] // 7 readings ≈ 75 ms
    const out = cleanVoice(vals, 'smooth')
    expect(out.slice(20, 27).every((x) => x === null)).toBe(true)
    expect(Math.max(...out.filter((x): x is number => x !== null))).toBeLessThan(60.5)
  })
  it('a real move to a new note is followed, without overshooting', () => {
    const out = cleanVoice([...held(60, 30), ...held(65, 40)], 'smooth') as number[]
    expect(out.at(-1)!).toBeGreaterThan(64.7)
    expect(Math.max(...out)).toBeLessThanOrEqual(65.0001)
    for (let i = 1; i < out.length; i++) if (out[i] !== null && out[i - 1] !== null) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]! - 1e-9)
  })
  it('a wobbly held note comes out calm', () => {
    const wobble = Array.from({ length: 120 }, (_, i) => 62 + 0.8 * Math.sin((2 * Math.PI * 5.5 * i) / 94) + (i % 3 - 1) * 0.3)
    const out = (cleanVoice(wobble, 'smooth') as number[]).slice(30)
    expect(Math.max(...out) - Math.min(...out)).toBeLessThan(0.9) // the raw line swings ~2.2
  })
  it('a phrase that starts on a bad reading starts where the voice really is', () => {
    const out = cleanVoice([72, ...held(60, 30)], 'smooth')
    expect(out[0]).toBeNull()
    expect(Math.max(...out.filter((x): x is number => x !== null))).toBeLessThan(60.01)
  })
  it('a fading voice (much quieter) is not drawn: no dive into the next note', () => {
    const vals = [...held(64, 30), 62, 60, 58, ...held(67, 20)]
    const levels = [...held(-18, 30), -32, -36, -40, ...held(-18, 20)]
    const out = cleanVoice(vals, 'smooth', false, 94, levels)
    expect(out.slice(30, 33)).toEqual([null, null, null])
  })
  it('the fading tail of a finished phrase is trimmed', () => {
    const vals = [...held(64, 40), 63, 61.5, 60, 58, 56]
    const out = cleanVoice(vals, 'smooth', true)
    expect(out.slice(-4).every((x) => x === null)).toBe(true)
  })
  it('a point once drawn never changes as more singing arrives', () => {
    const vals = Array.from({ length: 200 }, (_, i) => 60 + 3 * Math.sin(i / 30) + (i % 7 === 0 ? 12 : 0) + Math.sin(i * 1.7) * 0.4)
    const early = cleanVoice(vals.slice(0, 120), 'smooth')
    const later = cleanVoice(vals, 'smooth')
    early.forEach((v, i) => { if (v !== null) expect(later[i]).toBeCloseTo(v, 9) })
  })
})
