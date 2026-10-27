import { describe, expect, it } from 'vitest'
import type { Evaluation, NoteEval } from './evaluation'
import { availableAspects, reviewNotes } from './review'
import type { ReferenceNote } from './types'

const ne = (i: number, p: Partial<NoteEval>): NoteEval => ({
  noteIndex: i, sung: true, coverage: 1, userMidi: 60, relCents: 0, absCents: 0, onsetMs: 0, levelDb: -30, stability: null, clash: null, tone: null, attack: null, ...p,
})
const ev = (notes: NoteEval[]) => ({ notes } as unknown as Evaluation)
const ref: ReferenceNote[] = Array.from({ length: 6 }, (_, i) => ({ startTime: i, endTime: i + 0.8, midiPitch: 60, confidence: 1, sung: true, loudness: 0 }))

describe('pitch review', () => {
  const e = ev([ne(0, { relCents: 10 }), ne(1, { relCents: 80 }), ne(2, { relCents: -180 }), ne(3, { sung: false })])
  it('hits are not red, bigger misses are redder', () => {
    const r = reviewNotes(e, ref, 'pitch', 50, false)
    expect(r[0].severity).toBe(0)
    expect(r[1].severity!).toBeGreaterThan(0)
    expect(r[2].severity!).toBeGreaterThan(r[1].severity!)
    expect(r[1].label).toBe('a little sharp')
    expect(r[2].label).toBe('flat')
    expect(r[3]).toMatchObject({ missed: true, label: 'not sung' })
  })
  it('the same mistake is redder on strict than on easy', () => {
    const easy = reviewNotes(e, ref, 'pitch', 100, false)[1].severity!
    const strict = reviewNotes(e, ref, 'pitch', 25, false)[1].severity!
    expect(easy).toBe(0) // 80¢ is inside "easy"
    expect(strict).toBeGreaterThan(0.2)
  })
  it('exact mode flags wrong octaves fully', () => {
    const r = reviewNotes(ev([ne(0, { absCents: 1210 })]), ref, 'pitch', 50, true)
    expect(r[0]).toMatchObject({ severity: 1, label: 'wrong octave' })
  })
})

describe('timing, steadiness and loudness', () => {
  it('timing: small delays are free, big ones red', () => {
    const r = reviewNotes(ev([ne(0, { onsetMs: 40 }), ne(1, { onsetMs: 260 }), ne(2, { onsetMs: -200 })]), ref, 'timing', 50, false)
    expect(r[0].severity).toBe(0)
    expect(r[1].label).toBe('260 ms late')
    expect(r[2].label).toBe('200 ms early')
    expect(r[1].severity!).toBeGreaterThan(r[2].severity!)
  })
  it('steadiness: vibrato is not marked as wrong', () => {
    const st = (kind: 'vibrato' | 'unstable', score: number) => ({ kind, jitterCents: 0, driftCents: 0, vibratoHz: null, vibratoCents: null, score })
    const r = reviewNotes(ev([ne(0, { stability: st('vibrato', 0.95) }), ne(1, { stability: st('unstable', 0.2) })]), ref, 'steadiness', 50, false)
    expect(r[0].severity!).toBeLessThanOrEqual(0.15)
    expect(r[1].severity!).toBeGreaterThan(0.8)
  })
  it('loudness compares to the singer’s own level, not mic volume', () => {
    const loudRef = ref.map((n, i) => ({ ...n, loudness: i === 2 ? 8 : 0 }))
    const r = reviewNotes(ev([ne(0, { levelDb: -60 }), ne(1, { levelDb: -60 }), ne(2, { levelDb: -60 })]), loudRef, 'loudness', 50, false)
    expect(r[2].label).toBe('too soft here') // original gets louder, singer stays flat
    expect(r[0].label).toBe('matches the original')
  })
  it('lists only aspects with data', () => {
    expect(availableAspects(ev([ne(0, { onsetMs: null, levelDb: null })]), ref)).toEqual(['pitch', 'key'])
  })
})
