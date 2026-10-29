import { describe, expect, it } from 'vitest'
import { extendSpans, streakOf, type Span } from './juice'
import type { NoteResult } from '../lib/types'

const r = (i: number, status: NoteResult['status']): [number, NoteResult] => [i, { noteIndex: i, status, cents: 0, coverage: 1, onPitchRatio: 1, onsetDelta: 0 }]

describe('the lit melody', () => {
  it('grows while you stay on pitch and bridges a tiny gap', () => {
    let s: Span[] = []
    for (const t of [1, 1.016, 1.033, 1.05]) s = extendSpans(s, t, true)
    s = extendSpans(s, 1.08, false) // one frame off
    s = extendSpans(s, 1.1, true)
    expect(s).toHaveLength(1)
    expect(s[0].start).toBeCloseTo(0.97)
    expect(s[0].end).toBeCloseTo(1.1)
  })
  it('starts a new stretch after a real break', () => {
    let s: Span[] = []
    s = extendSpans(s, 1, true)
    s = extendSpans(s, 1.5, true)
    expect(s).toHaveLength(2)
  })
})

describe('streak', () => {
  it('counts the hits in a row back from the latest note', () => {
    expect(streakOf(new Map([r(1, 'hit'), r(2, 'flat'), r(3, 'hit'), r(5, 'hit')]))).toBe(2)
    expect(streakOf(new Map([r(1, 'hit'), r(2, 'missed')]))).toBe(0)
    expect(streakOf(new Map())).toBe(0)
  })
})
