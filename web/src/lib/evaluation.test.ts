import { describe, expect, it } from 'vitest'
import { analyseStability, DEFAULT_EVAL, estimateLag, evaluate, liveGuidance, overallScore, type EvalSettings } from './evaluation'
import { noteAt } from './scoring'
import type { HarmonySegment, ReferenceNote, UserFrame } from './types'

// Reference: two phrases with real movement and dynamics (soft → loud).
const PITCHES = [60, 62, 64, 62, 67, 65, 64, 62]
const LOUD = [-6, -6, -5, -6, 5, 6, 5, 4]
const notes: ReferenceNote[] = PITCHES.map((m, i) => {
  const line = i < 4 ? 0 : 1
  const start = i * 0.6 + line * 0.6
  return { startTime: start, endTime: start + 0.5, midiPitch: m, confidence: 1, sung: true, line, loudness: LOUD[i] }
})
const END = notes[notes.length - 1].endTime + 0.5

type Gen = (t: number, n: ReferenceNote | null, i: number) => { midi: number | null; level?: number; clarity?: number }

/** 100 Hz user frames; unvoiced frames get a quiet room-noise level. */
function sing(gen: Gen, from = 0, to = END): UserFrame[] {
  const out: UserFrame[] = []
  for (let t = from; t < to; t += 0.01) {
    const i = noteAt(notes, t)
    const g = gen(t, i >= 0 ? notes[i] : null, i)
    out.push({ t, midi: g.midi, clarity: g.clarity ?? 0.95, level: g.level ?? (g.midi === null ? -70 : -30) })
  }
  return out
}
const follow = (offset = 0, gain = 0): Gen => (_t, n, i) =>
  n ? { midi: n.midiPitch + offset, level: -30 + gain + LOUD[i] } : { midi: null }

const S: EvalSettings = { ...DEFAULT_EVAL }

describe('melody shape (key and octave free)', () => {
  it('scores a perfect copy at 100%', () => {
    const e = evaluate(notes, sing(follow()), 0, END, S)
    expect(e.metrics.shape.score).toBeCloseTo(1, 5)
    expect(e.keyOffset).toBeCloseTo(0, 5)
  })

  it.each([5, -7, -12, 12])('does not penalise singing %i semitones away', (off) => {
    const e = evaluate(notes, sing(follow(off)), 0, END, S)
    expect(e.metrics.shape.score).toBeCloseTo(1, 5)
    expect(e.keyOffset).toBeCloseTo(off, 5)
  })

  it('…while exact pitch (optional mode) does penalise it', () => {
    const e = evaluate(notes, sing(follow(5)), 0, END, { ...S, exactEnabled: true })
    expect(e.metrics.exact.score!).toBeLessThan(0.05)
  })

  it('an inverted contour scores low even in the right key', () => {
    const inverted: Gen = (_t, n) => (n ? { midi: 2 * 63 - n.midiPitch } : { midi: null })
    expect(evaluate(notes, sing(inverted), 0, END, S).metrics.shape.score!).toBeLessThan(0.35)
  })

  it('one wrong interval lowers the score proportionally', () => {
    const oneOff: Gen = (_t, n, i) => (n ? { midi: n.midiPitch + (i === 4 ? -3 : 0) } : { midi: null })
    const sc = evaluate(notes, sing(oneOff), 0, END, S).metrics.shape.score!
    expect(sc).toBeGreaterThan(0.6)
    expect(sc).toBeLessThan(0.95)
  })

  it('folds a single octave flip instead of calling everything wrong', () => {
    const flip: Gen = (_t, n, i) => (n ? { midi: n.midiPitch + (i === 2 ? 12 : 0) } : { midi: null })
    const e = evaluate(notes, sing(flip), 0, END, S)
    expect(e.octaveFlips).toBe(1)
    expect(e.metrics.shape.score!).toBeGreaterThan(0.9)
  })
})

describe('silence and missing data are never rewarded', () => {
  it('a silent singer gets null metrics (not a high score) and no overall', () => {
    const e = evaluate(notes, sing(() => ({ midi: null })), 0, END, { ...S, exactEnabled: true })
    for (const m of Object.values(e.metrics)) expect(m.score).toBeNull()
    expect(e.overall.score).toBeNull()
    expect(e.metrics.shape.note).toMatch(/not enough/)
  })

  it('singing only one note is "not enough to judge"', () => {
    const one: Gen = (_t, n, i) => (n && i === 0 ? { midi: 60 } : { midi: null })
    expect(evaluate(notes, sing(one), 0, END, S).metrics.shape.score).toBeNull()
  })

  it('short gaps for consonants do not count as wrong pitch', () => {
    const gappy: Gen = (t, n) => (n && (t - n.startTime) % 0.25 > 0.04 ? { midi: n.midiPitch } : { midi: null })
    expect(evaluate(notes, sing(gappy), 0, END, S).metrics.shape.score).toBeCloseTo(1, 5)
  })
})

describe('dynamics (relative, gain independent)', () => {
  it('following the soft→loud profile scores high at any mic gain', () => {
    for (const gain of [-20, 0, 15]) {
      const sc = evaluate(notes, sing(follow(0, gain)), 0, END, S).metrics.dynamics.score!
      expect(sc).toBeGreaterThan(0.95)
    }
  })

  it('singing everything at one level scores lower', () => {
    const flat: Gen = (_t, n) => (n ? { midi: n.midiPitch, level: -30 } : { midi: null })
    expect(evaluate(notes, sing(flat), 0, END, S).metrics.dynamics.score!).toBeLessThan(0.5)
  })

  it('reversed dynamics score lowest', () => {
    const rev: Gen = (_t, n, i) => (n ? { midi: n.midiPitch, level: -30 - LOUD[i] } : { midi: null })
    expect(evaluate(notes, sing(rev), 0, END, S).metrics.dynamics.score!).toBeLessThan(0.2)
  })

  it('is null when the reference has no dynamics data (e.g. charts)', () => {
    const plain = notes.map(({ loudness: _l, ...n }) => n)
    expect(evaluate(plain, sing(follow()), 0, END, S).metrics.dynamics.score).toBeNull()
  })

  it('is null — not "sing louder" — when the voice is barely above the noise', () => {
    const weak: Gen = (_t, n) => (n ? { midi: n.midiPitch, level: -68 } : { midi: null, level: -70 })
    const m = evaluate(notes, sing(weak), 0, END, S).metrics.dynamics
    expect(m.score).toBeNull()
    expect(m.note).toMatch(/not a reason to sing louder/)
  })
})

describe('rhythm and phrasing', () => {
  const late = (ms: number): Gen => (t, _n) => {
    const i = noteAt(notes, t - ms / 1000)
    return i >= 0 ? { midi: notes[i].midiPitch } : { midi: null }
  }
  it('on time scores ~100%', () => {
    expect(evaluate(notes, sing(follow()), 0, END, S).metrics.rhythm.score!).toBeGreaterThan(0.95)
  })
  it('small expressive delays (50 ms) are free', () => {
    expect(evaluate(notes, sing(late(50)), 0, END, S).metrics.rhythm.score!).toBeGreaterThan(0.9)
  })
  it('consistently late by 250 ms is penalised and reported', () => {
    const e = evaluate(notes, sing(late(250)), 0, END, S)
    expect(e.metrics.rhythm.score!).toBeLessThan(0.6)
    expect(e.metrics.rhythm.details.medianOnsetMs).toBeGreaterThan(200)
    expect(e.timeOffsetMs).toBeGreaterThan(200)
  })
  it('singing straight through the phrase break is noticed', () => {
    const through: Gen = (t) => {
      const i = noteAt(notes, t)
      if (i >= 0) return { midi: notes[i].midiPitch }
      return t > 2.3 && t < 3.0 ? { midi: 62 } : { midi: null }
    }
    const e = evaluate(notes, sing(through), 0, END, S)
    expect(e.metrics.rhythm.details.pausesRespected).toBeLessThan(1)
  })
  it('estimates latency-like lag so other metrics still line up', () => {
    expect(estimateLag(notes, sing(late(150)))).toBeCloseTo(0.15, 1)
    expect(evaluate(notes, sing(late(150)), 0, END, S).metrics.shape.score).toBeCloseTo(1, 5)
  })
})

describe('vocal stability', () => {
  const sustained = (f: (t: number) => number, len = 1.2): UserFrame[] => {
    const out: UserFrame[] = []
    for (let t = 0; t < len; t += 1 / 94) out.push({ t, midi: f(t), clarity: 0.95, level: -30 })
    return out
  }
  let seed = 3
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1

  it('a straight note is steady', () => {
    const st = analyseStability(sustained(() => 60))!
    expect(st.kind).toBe('steady')
    expect(st.score).toBeCloseTo(1, 5)
  })
  it('healthy vibrato (5.5 Hz, ±40¢) is recognised and NOT penalised vs a straight note', () => {
    const st = analyseStability(sustained((t) => 60 + 0.4 * Math.sin(2 * Math.PI * 5.5 * t)))!
    expect(st.kind).toBe('vibrato')
    expect(st.vibratoHz).toBeCloseTo(5.5, 0)
    expect(st.vibratoCents!).toBeGreaterThan(30)
    expect(st.score).toBeGreaterThan(0.95)
  })
  it('random wavering is unstable', () => {
    const st = analyseStability(sustained(() => 60 + rand() * 0.6))!
    expect(st.kind).toBe('unstable')
    expect(st.score).toBeLessThan(0.4)
  })
  it('very wide vibrato is flagged as wobble and capped', () => {
    const st = analyseStability(sustained((t) => 60 + 1.6 * Math.sin(2 * Math.PI * 5 * t)))!
    expect(st.kind).toBe('wobble')
    expect(st.score).toBeLessThanOrEqual(0.6)
  })
  it('slow drift is penalised less than jitter', () => {
    const drift = analyseStability(sustained((t) => 60 + 0.5 * t))!
    expect(drift.driftCents).toBeGreaterThan(40)
    expect(drift.score).toBeGreaterThan(0.7)
  })
})

describe('harmony check (informational)', () => {
  const chords: HarmonySegment[] = [{ start: 0, end: 10, pcs: [0, 4, 7], confidence: 1 }]
  it('melody notes and chord tones are fine, other notes clash', () => {
    const third: Gen = (_t, n) => (n ? { midi: n.midiPitch === 60 ? 64 : n.midiPitch } : { midi: null })
    const e = evaluate(notes, sing(third), 0, END, S, chords)
    expect(e.harmony.available).toBe(true)
    expect(e.notes.find((x) => x.noteIndex === 0)!.clash).toBe(false) // E over C major = chord tone
  })
  it('a non-octave key offset is flagged as clashing with the backing', () => {
    const e = evaluate(notes, sing(follow(5)), 0, END, S, chords)
    expect(e.harmony.keyClash).toBe(true)
    expect(e.metrics.shape.score).toBeCloseTo(1, 5) // still not penalised in shape
  })
  it('an octave offset does not clash', () => {
    expect(evaluate(notes, sing(follow(-12)), 0, END, S, chords).harmony.keyClash).toBe(false)
  })
  it('without reliable harmony nothing is claimed', () => {
    const e = evaluate(notes, sing(follow(5)), 0, END, S, [{ start: 0, end: 10, pcs: [0, 4, 7], confidence: 0.3 }])
    expect(e.harmony.available).toBe(false)
  })
})

describe('overall matches the scores shown', () => {
  it('overall is the average of the scores next to it — in key or not, it sits among them', () => {
    for (const off of [0, 5, -10]) {
      const e = evaluate(notes, sing(follow(off)), 0, END, S)
      const shown = Object.entries(e.overall.weights).map(([k]) => e.metrics[k as keyof typeof e.metrics].score!)
      const mean = Object.entries(e.overall.weights).reduce((a, [k, w]) => a + e.metrics[k as keyof typeof e.metrics].score! * w!, 0)
      expect(e.overall.score!).toBeCloseTo(mean, 6)
      expect(e.overall.score!).toBeGreaterThanOrEqual(Math.min(...shown) - 1e-9)
      expect(e.overall.score!).toBeLessThanOrEqual(Math.max(...shown) + 1e-9)
    }
  })
})

describe('overall score is transparent', () => {
  it('reports normalised weights and skips unavailable metrics', () => {
    const e = evaluate(notes.map(({ loudness: _l, ...n }) => n), sing(follow()), 0, END, S)
    expect(e.metrics.dynamics.score).toBeNull()
    expect(e.overall.weights.dynamics).toBeUndefined()
    expect(e.overall.weights.exact).toBeUndefined() // exact mode off
    const total = Object.values(e.overall.weights).reduce((a, b) => a + b!, 0)
    expect(total).toBeCloseTo(1, 9)
  })
  it('is the plain average of the scores shown, whatever the old weights setting says', () => {
    const m = evaluate(notes, sing(follow()), 0, END, S).metrics
    const lopsided = { ...S, weights: { shape: 0, harmony: 0, tone: 0, attack: 0, dynamics: 0, stability: 0, exact: 0, rhythm: 1 } }
    const o = overallScore(m, lopsided)
    const shown = (Object.keys(m) as (keyof typeof m)[]).filter((k) => k !== 'exact' && m[k].score !== null).map((k) => m[k].score!)
    expect(o.score!).toBeCloseTo(shown.reduce((a, b) => a + b, 0) / shown.length, 9)
    expect(o.score).toBe(overallScore(m, S).score)
  })
})

describe('live guidance', () => {
  const base = { keyOffset: null, exact: false, tolerance: 50, prevPitch: null, userLevelRel: null, refLevelRel: null, levelReliable: false }
  it('is octave-free in shape mode', () => {
    expect(liveGuidance({ ...base, userMidi: 48.1, targetMidi: 60 }).pitch).toBe('on')
    expect(liveGuidance({ ...base, userMidi: 48.1, targetMidi: 60, exact: true }).pitch).toBeNull() // octave off: no higher/lower nag
  })
  it('uses the singer’s key offset', () => {
    expect(liveGuidance({ ...base, userMidi: 65, targetMidi: 60, keyOffset: 5 }).pitch).toBe('on')
    expect(liveGuidance({ ...base, userMidi: 64, targetMidi: 60, keyOffset: 5 }).pitch).toBe('higher')
    expect(liveGuidance({ ...base, userMidi: 66, targetMidi: 60, keyOffset: 5 }).pitch).toBe('lower')
  })
  it('gives dynamics hints only with a reliable signal, relative to the singer', () => {
    const g = { ...base, userMidi: 60, targetMidi: 60 }
    expect(liveGuidance({ ...g, userLevelRel: -2, refLevelRel: 6, levelReliable: true }).dynamics).toBe('more')
    expect(liveGuidance({ ...g, userLevelRel: 4, refLevelRel: -5, levelReliable: true }).dynamics).toBe('softer')
    expect(liveGuidance({ ...g, userLevelRel: -2, refLevelRel: 6, levelReliable: false }).dynamics).toBeNull()
    expect(liveGuidance({ ...g, userLevelRel: 0, refLevelRel: 1, levelReliable: true }).dynamics).toBeNull()
  })
})

describe('in tune with the music', () => {
  it('your key = the song\u2019s key, or an exact octave: full marks', () => {
    for (const off of [0, -12, 12]) expect(evaluate(notes, sing(follow(off)), 0, END, S).metrics.harmony.score).toBeCloseTo(1, 5)
  })
  it('a different key clashes with the backing — even with a perfect melody shape', () => {
    const e = evaluate(notes, sing(follow(5)), 0, END, S)
    expect(e.metrics.shape.score).toBeCloseTo(1, 5)
    expect(e.metrics.harmony.score!).toBeLessThan(0.05)
  })
  it('a slightly flat key (40 cents) loses a little', () => {
    const sc = evaluate(notes, sing(follow(-0.4)), 0, END, S).metrics.harmony.score!
    expect(sc).toBeGreaterThan(0.65) // 0.7 on the grading curve every score goes through
    expect(sc).toBeLessThan(0.95)
  })
  it('counts chord clashes when the chords are known', () => {
    const chords = [{ start: 0, end: 10, pcs: [0, 4, 7], confidence: 1 }]
    const wrongNotes: Gen = (_t, n, i) => (n ? { midi: n.midiPitch + (i % 2 ? 1 : 0) } : { midi: null }) // every other note a semitone off
    const e = evaluate(notes, sing(wrongNotes), 0, END, S, chords)
    expect(e.metrics.harmony.details.clashes).toBeGreaterThan(0)
    expect(e.metrics.harmony.score!).toBeLessThan(evaluate(notes, sing(follow()), 0, END, S, chords).metrics.harmony.score!)
  })
})

describe('tone clarity', () => {
  it('a clean voice scores high', () => {
    expect(evaluate(notes, sing((_t, n) => (n ? { midi: n.midiPitch, clarity: 0.97 } : { midi: null })), 0, END, S).metrics.tone.score!).toBeGreaterThan(0.9)
  })
  it('a breathy / raspy voice (loud but not clean) scores low', () => {
    const breathy: Gen = (t, n) => (n ? (Math.floor(t * 100) % 2 ? { midi: n.midiPitch, clarity: 0.82 } : { midi: null, clarity: 0.65, level: -32 }) : { midi: null })
    expect(evaluate(notes, sing(breathy), 0, END, S).metrics.tone.score!).toBeLessThan(0.45)
  })
  it('is not judged when the voice is buried in background noise', () => {
    const buried: Gen = (_t, n) => (n ? { midi: n.midiPitch, level: -68 } : { midi: null, level: -70 })
    expect(evaluate(notes, sing(buried), 0, END, S).metrics.tone.score).toBeNull()
  })
})

describe('note attack', () => {
  it('landing straight on the notes scores high', () => {
    expect(evaluate(notes, sing(follow()), 0, END, S).metrics.attack.score!).toBeGreaterThan(0.9)
  })
  it('scooping up into every note is caught', () => {
    const scoop: Gen = (t, n) => (n ? { midi: n.midiPitch - (t - n.startTime < 0.18 ? 1.5 : 0) } : { midi: null })
    const m = evaluate(notes, sing(scoop), 0, END, S).metrics.attack
    expect(m.details.scoops).toBeGreaterThan(2)
    expect(m.score!).toBeLessThan(0.6)
  })
})

describe('out of key lowers the overall (once, through "in key")', () => {
  it('a perfect shape in the wrong key loses its "in key" share', () => {
    const right = evaluate(notes, sing(follow(0)), 0, END, S)
    const wrong = evaluate(notes, sing(follow(5)), 0, END, S)
    expect(right.overall.score!).toBeGreaterThan(0.95)
    expect(wrong.metrics.harmony.score!).toBeLessThan(0.1)
    expect(wrong.overall.score!).toBeLessThan(0.9)
    expect(wrong.harmony.keyClash).toBe(true) // said in words too, even with no chords to check
  })
  it('an octave down is not out of key', () => {
    expect(evaluate(notes, sing(follow(-12)), 0, END, S).overall.score!).toBeGreaterThan(0.95)
  })
})
