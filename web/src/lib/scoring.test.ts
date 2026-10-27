import { describe, expect, it } from 'vitest'
import { classifyLive, DEFAULT_SCORE, noteAt, scoreRange } from './scoring'
import { buildPhrases, lyricLineAt, suggestBreaths } from './phrases'
import { clampSeek, ctxTimeFor, loopJump, phraseLoop, songTimeAt } from './timeline'
import type { ReferenceNote, UserFrame } from './types'

const note = (s: number, e: number, m: number, extra: Partial<ReferenceNote> = {}): ReferenceNote => ({
  startTime: s, endTime: e, midiPitch: m, confidence: 1, sung: true, ...extra,
})

/** User frames every 10 ms over [a,b) at a given MIDI value (or null). */
function frames(a: number, b: number, midi: number | null | ((t: number) => number | null)): UserFrame[] {
  const out: UserFrame[] = []
  for (let t = a; t < b; t += 0.01) out.push({ t, midi: typeof midi === 'function' ? midi(t) : midi, clarity: 0.95 })
  return out
}

const melody = [note(0, 1, 60), note(1, 2, 62), note(2, 3, 64), note(3, 4, 65)]

describe('scoreRange', () => {
  it('perfect singing scores 100%', () => {
    const f = frames(0, 4, (t) => melody[noteAt(melody, t)]?.midiPitch ?? null)
    const s = scoreRange(melody, f, 0, 4)
    expect(s.hit).toBe(4)
    expect(s.accuracy).toBeCloseTo(1, 5)
    expect(s.pitchAccuracy).toBeCloseTo(1, 5)
    expect(s.medianAbsCents).toBeCloseTo(0, 5)
  })

  it('a silent user gets 0%, all notes missed — not "wrong", and no pitch accuracy', () => {
    const s = scoreRange(melody, frames(0, 4, null), 0, 4)
    expect(s.accuracy).toBe(0)
    expect(s.missed).toBe(4)
    expect(s.sharp + s.flat + s.octave).toBe(0)
    expect(s.pitchAccuracy).toBeNull()
  })

  it('no recorded frames at all → nothing scored (not attempted)', () => {
    const s = scoreRange(melody, [], 0, 4)
    expect(s.notesTotal).toBe(0)
  })

  it('classifies sharp and flat with cents', () => {
    const f = [...frames(0, 1, 60.8), ...frames(1, 2, 61.3), ...frames(2, 3, 64.2), ...frames(3, 4, 65)]
    const s = scoreRange(melody, f, 0, 4)
    expect(s.notes.map((n) => n.status)).toEqual(['sharp', 'flat', 'hit', 'hit'])
    expect(s.notes[0].cents).toBeCloseTo(80, 3)
    expect(s.notes[1].cents).toBeCloseTo(-70, 3)
  })

  it('reports octave errors separately', () => {
    const f = frames(0, 1, 48.1) // an octave below C4, 10 cents sharp
    const s = scoreRange([melody[0]], f, 0, 1)
    expect(s.notes[0].status).toBe('octave')
    expect(s.notes[0].cents).toBeCloseTo(10, 3)
    expect(s.octave).toBe(1)
    expect(s.accuracy).toBe(0)
  })

  it('respects the configurable tolerance', () => {
    const f = frames(0, 1, 60.4)
    expect(scoreRange([melody[0]], f, 0, 1, { ...DEFAULT_SCORE, toleranceCents: 50 }).hit).toBe(1)
    expect(scoreRange([melody[0]], f, 0, 1, { ...DEFAULT_SCORE, toleranceCents: 25 }).sharp).toBe(1)
  })

  it('applies transpose to the reference', () => {
    const f = frames(0, 1, 62)
    expect(scoreRange([melody[0]], f, 0, 1, { ...DEFAULT_SCORE, transpose: 2 }).hit).toBe(1)
  })

  it('ignores unsung and low-confidence notes', () => {
    const notes = [note(0, 1, 60, { sung: false }), note(1, 2, 62, { confidence: 0.2 })]
    expect(scoreRange(notes, frames(0, 2, 50), 0, 2).notesTotal).toBe(0)
  })

  it('a short pause inside a note lowers coverage but is not wrong pitch', () => {
    const f = frames(0, 1, (t) => (t > 0.4 && t < 0.6 ? null : 60))
    const s = scoreRange([melody[0]], f, 0, 1)
    expect(s.notes[0].status).toBe('hit')
    expect(s.coverage).toBeLessThan(1)
    expect(s.pitchAccuracy).toBeCloseTo(1, 5)
  })

  it('measures onset timing', () => {
    const f = frames(0, 1, (t) => (t < 0.12 ? null : 60))
    const s = scoreRange([melody[0]], f, 0, 1)
    expect(s.medianOnsetMs!).toBeGreaterThan(100)
    expect(s.medianOnsetMs!).toBeLessThan(140)
  })

  it('only scores notes fully inside the range (section scoring)', () => {
    const f = frames(0, 4, (t) => melody[noteAt(melody, t)]?.midiPitch ?? null)
    expect(scoreRange(melody, f, 1, 3).notesTotal).toBe(2)
  })

  it('vibrato within tolerance still counts as on pitch', () => {
    const f = frames(0, 1, (t) => 60 + 0.35 * Math.sin(2 * Math.PI * 5.5 * t))
    expect(scoreRange([melody[0]], f, 0, 1).hit).toBe(1)
  })
})

describe('live classification', () => {
  it('labels states with hysteresis', () => {
    expect(classifyLive(null, 60, 50, 'idle').state).toBe('no-voice')
    expect(classifyLive(60, null, 50, 'idle').state).toBe('listening')
    expect(classifyLive(60.2, 60, 50, 'idle').state).toBe('on-pitch')
    expect(classifyLive(60.48, 60, 50, 'flat').state).toBe('sharp') // outside narrowed band
    expect(classifyLive(60.53, 60, 50, 'on-pitch').state).toBe('on-pitch') // widened band
    expect(classifyLive(59.0, 60, 50, 'idle').state).toBe('flat')
    expect(classifyLive(72.1, 60, 50, 'idle').state).toBe('octave')
  })
})

describe('time alignment, seeking and looping', () => {
  it('maps ctx time to song time at any speed', () => {
    const a = { ctxStart: 10, songStart: 30, speed: 0.75 }
    expect(songTimeAt(a, 14)).toBeCloseTo(33, 9)
    expect(ctxTimeFor(a, 33)).toBeCloseTo(14, 9)
  })
  it('clamps seeks into the song', () => {
    expect(clampSeek(-3, 100)).toBe(0)
    expect(clampSeek(500, 100)).toBeCloseTo(99.95)
    expect(clampSeek(NaN, 100)).toBe(0)
    expect(clampSeek(42, 100)).toBe(42)
  })
  it('loops back at the region end only', () => {
    const loop = { start: 5, end: 9 }
    expect(loopJump(8.9, loop)).toBeNull()
    expect(loopJump(9, loop)).toBe(5)
    expect(loopJump(12, null)).toBeNull()
  })
  it('builds a phrase loop with lead-in, clamped to the song', () => {
    expect(phraseLoop(0.5, 4, 10)).toEqual({ start: 0, end: 4.4 })
    expect(phraseLoop(5, 9.9, 10)).toEqual({ start: 4, end: 10 })
  })
})

describe('phrases, lyrics and breaths', () => {
  const notes = [note(0, 1, 60, { line: 0 }), note(1, 2, 62, { line: 0 }), note(3, 4, 64, { line: 1 })]
  it('uses line markers when present', () => {
    expect(buildPhrases(notes)).toEqual([{ index: 0, start: 0, end: 2 }, { index: 1, start: 3, end: 4 }])
  })
  it('falls back to gaps', () => {
    const p = buildPhrases(notes.map(({ line: _l, ...n }) => n))
    expect(p.length).toBe(2)
  })
  it('suggests breaths only where the melody has a gap', () => {
    const b = suggestBreaths(buildPhrases(notes))
    expect(b).toHaveLength(1)
    expect(b[0].kind).toBe('suggested')
    expect(b[0].time).toBeGreaterThan(2)
    expect(b[0].time).toBeLessThan(3)
  })
  it('finds the current lyric line and ignores untimed lines', () => {
    const lines = [
      { id: 'a', start: 0, end: 2, text: 'one', verified: true },
      { id: 'b', start: null, end: null, text: 'untimed', verified: false },
      { id: 'c', start: 3, end: 4, text: 'two', verified: true },
    ]
    expect(lyricLineAt(lines, 1)).toBe(0)
    expect(lyricLineAt(lines, 3.5)).toBe(2)
  })
})
