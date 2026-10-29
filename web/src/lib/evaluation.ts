// Multi-dimensional singing evaluation. Pure functions of (reference, user
// frames, settings) — no audio or UI — so every rule is unit-testable.
//
// Five independent metrics, each 0..1 or null ("not measurable this take",
// always with a reason). Nothing is ever filled in or simulated:
//
//   shape      melody contour: direction + intervals, any key/octave allowed
//   dynamics   relative loudness profile vs. the reference vocal
//   rhythm     onsets, phrase endings and pauses, with expressive tolerance
//   stability  steadiness on sustained notes; healthy vibrato is not penalised
//   exact      absolute pitch vs. the original (optional mode)
//
// The optional overall score is the plain average of the scores shown next to it
// (every available metric counts the same), so it's the same number everywhere.

import { centsBetweenMidi, clamp, median } from './music'
import { isScorable, lowerBound, scoreRange } from './scoring'
import type { HarmonySegment, MetricKey, ReferenceNote, UserFrame } from './types'

export type Weights = Record<MetricKey, number>

export const DEFAULT_WEIGHTS: Weights = { shape: 30, harmony: 25, rhythm: 20, tone: 15, stability: 15, attack: 10, dynamics: 15, exact: 30 }

export interface EvalSettings {
  /** Cents tolerance: intervals in shape mode, absolute pitch in exact mode. */
  toleranceCents: number
  transpose: number
  minNoteConfidence: number
  exactEnabled: boolean
  weights: Weights
}

export const DEFAULT_EVAL: EvalSettings = {
  toleranceCents: 50,
  transpose: 0,
  minNoteConfidence: 0.5,
  exactEnabled: false,
  weights: DEFAULT_WEIGHTS,
}

export interface MetricResult {
  score: number | null
  /** Why the score is null, or a short note on what it is based on. */
  note: string
  details: Record<string, number | string | null>
}

export type StabilityKind = 'steady' | 'vibrato' | 'wobble' | 'unstable'

export interface NoteEval {
  noteIndex: number
  sung: boolean
  coverage: number
  /** Median user pitch (MIDI) during the note core. */
  userMidi: number | null
  /** Deviation after removing the singer's key offset (shape mode), cents. */
  relCents: number | null
  /** Absolute deviation from reference (+transpose), cents. */
  absCents: number | null
  onsetMs: number | null
  levelDb: number | null
  stability: { kind: StabilityKind; jitterCents: number; driftCents: number; vibratoHz: number | null; vibratoCents: number | null; score: number } | null
  /** true = sung pitch class clashes with the accompaniment chord. null = harmony unknown. */
  clash: boolean | null
  /** Voice clarity on this note: median periodicity (0..1) and share of noisy frames. */
  tone: { clarity: number; noisy: number } | null
  /** How the note started: ms until it settled on pitch (null = never), and whether it scooped up from below. */
  attack: { settleMs: number | null; scoop: boolean } | null
}

export interface Evaluation {
  from: number
  to: number
  notesTotal: number
  notesSung: number
  /** Semitones between the user's key and the reference (+transpose). null if unknown. */
  keyOffset: number | null
  octaveFlips: number
  /** Best overall alignment lag between user and reference (ms, + = user late). */
  timeOffsetMs: number
  metrics: Record<MetricKey, MetricResult>
  overall: { score: number | null; weights: Partial<Record<MetricKey, number>> }
  harmony: { available: boolean; checked: number; clashes: number; keyClash: boolean }
  notes: NoteEval[]
}

// ---- helpers -----------------------------------------------------------------

const ramp = (x: number, full: number, zero: number) => clamp(1 - (x - full) / (zero - full), 0, 1)
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const percentile = (v: number[], p: number) => {
  if (!v.length) return NaN
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]
}
function pearson(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b)
  let num = 0, da = 0, db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

function framesIn(frames: UserFrame[], a: number, b: number): UserFrame[] {
  const out: UserFrame[] = []
  for (let i = lowerBound(frames, a); i < frames.length && frames[i].t < b; i++) out.push(frames[i])
  return out
}

/**
 * Global lag (s) that best aligns user voicing with reference note presence,
 * searched within ±maxLag. Used to place analysis windows (shape, stability,
 * dynamics); rhythm is judged on raw timing and reports this lag separately.
 */
export function estimateLag(notes: ReferenceNote[], frames: UserFrame[], maxLag = 0.25): number {
  const voiced = frames.filter((f) => f.midi !== null)
  if (voiced.length < 30 || !notes.length) return 0
  const inNote = (t: number) => {
    let lo = 0, hi = notes.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (t < notes[mid].startTime) hi = mid - 1
      else if (t >= notes[mid].endTime) lo = mid + 1
      else return true
    }
    return false
  }
  const score = (lag: number) => voiced.reduce((s, f) => s + (inNote(f.t - lag) ? 1 : 0), 0)
  const base = score(0)
  let best = 0, bestScore = base
  for (let lag = -maxLag; lag <= maxLag + 1e-9; lag += 0.01) {
    const sc = score(lag)
    if (sc > bestScore || (sc === bestScore && Math.abs(lag) < Math.abs(best))) {
      bestScore = sc
      best = lag
    }
  }
  return bestScore - base > voiced.length * 0.03 ? Math.round(best * 100) / 100 : 0
}

// ---- stability -----------------------------------------------------------------

/**
 * Pitch steadiness of one sustained note. Fits drift (linear) and the best
 * 4–8 Hz sinusoid; a clear sinusoid of moderate extent is vibrato and is not
 * counted as instability. Score depends only on what is left over (jitter)
 * and slow drift — a straight note and a healthy vibrato score the same.
 */
export function analyseStability(frames: UserFrame[]): NoteEval['stability'] {
  const pts = frames.filter((f) => f.midi !== null)
  if (pts.length < 25) return null
  const t = pts.map((f) => f.t - pts[0].t)
  const c0 = median(pts.map((f) => f.midi!))
  const c = pts.map((f) => (f.midi! - c0) * 100)
  const n = c.length
  const tm = mean(t), cm = mean(c)
  let sxy = 0, sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (t[i] - tm) * (c[i] - cm)
    sxx += (t[i] - tm) ** 2
  }
  const slope = sxx ? sxy / sxx : 0
  const r = c.map((v, i) => v - cm - slope * (t[i] - tm))
  const driftCents = Math.abs(slope * (t[n - 1] - t[0]))
  const totalVar = mean(r.map((v) => v * v))

  let bestHz = 0, bestAmp = 0, bestResid = r
  let bestR2 = 0
  if (t[n - 1] >= 0.3 && totalVar > 1) {
    for (let hz = 4; hz <= 8.001; hz += 0.25) {
      let ss = 0, cc = 0, sc = 0, sr = 0, cr = 0
      for (let i = 0; i < n; i++) {
        const s = Math.sin(2 * Math.PI * hz * t[i]), co = Math.cos(2 * Math.PI * hz * t[i])
        ss += s * s; cc += co * co; sc += s * co; sr += s * r[i]; cr += co * r[i]
      }
      const det = ss * cc - sc * sc
      if (Math.abs(det) < 1e-9) continue
      const a = (sr * cc - cr * sc) / det
      const b = (cr * ss - sr * sc) / det
      const resid = r.map((v, i) => v - a * Math.sin(2 * Math.PI * hz * t[i]) - b * Math.cos(2 * Math.PI * hz * t[i]))
      const r2 = 1 - mean(resid.map((v) => v * v)) / totalVar
      if (r2 > bestR2) {
        bestR2 = r2
        bestHz = hz
        bestAmp = Math.hypot(a, b)
        bestResid = resid
      }
    }
  }
  const isVibrato = bestR2 >= 0.5 && bestAmp >= 12
  const residual = isVibrato ? bestResid : r
  const jitterCents = Math.sqrt(mean(residual.map((v) => v * v)))
  let kind: StabilityKind = 'steady'
  if (isVibrato) kind = bestAmp > 120 ? 'wobble' : 'vibrato'
  if (jitterCents > 25) kind = 'unstable'
  let score = 0.85 * ramp(jitterCents, 12, 40) + 0.15 * ramp(driftCents, 30, 120)
  if (kind === 'wobble') score = Math.min(score, 0.6)
  return {
    kind,
    jitterCents,
    driftCents,
    vibratoHz: isVibrato ? bestHz : null,
    vibratoCents: isVibrato ? bestAmp : null,
    score,
  }
}

// ---- harmony -----------------------------------------------------------------

export function chordAt(harmony: HarmonySegment[] | undefined, t: number, minConfidence = 0.6): HarmonySegment | null {
  if (!harmony) return null
  for (const h of harmony) if (t >= h.start && t < h.end) return h.confidence >= minConfidence ? h : null
  return null
}

/** Does the sung note fit? Same pitch class as the melody or a chord tone = ok. */
export function clashesWith(userMidi: number, refMidi: number, chord: HarmonySegment): boolean {
  const pc = (m: number) => ((Math.round(m) % 12) + 12) % 12
  const u = pc(userMidi)
  return u !== pc(refMidi) && !chord.pcs.includes(u)
}

// ---- main ----------------------------------------------------------------------

export function evaluate(
  notesAll: ReferenceNote[],
  frames: UserFrame[],
  from: number,
  to: number,
  s: EvalSettings = DEFAULT_EVAL,
  harmony?: HarmonySegment[],
): Evaluation {
  const idx: number[] = []
  notesAll.forEach((n, i) => {
    if (n.startTime >= from && n.endTime <= to && isScorable(n, { ...s, minCoverage: 0.25 })) idx.push(i)
  })
  const notes = idx.map((i) => notesAll[i])
  const lag = estimateLag(notes, frames)
  const target = (n: ReferenceNote) => n.midiPitch + s.transpose

  // Per-note measurements
  const evals: NoteEval[] = notes.map((n, k) => {
    const dur = n.endTime - n.startTime
    const edge = Math.min(0.06, dur * 0.2)
    const core = framesIn(frames, n.startTime + edge + lag, n.endTime - edge + lag)
    const voiced = core.filter((f) => f.midi !== null)
    const coverage = core.length ? voiced.length / core.length : 0
    const userMidi = voiced.length ? median(voiced.map((f) => f.midi!)) : null
    const levels = voiced.map((f) => f.level).filter((l): l is number => l !== undefined)
    return {
      noteIndex: idx[k],
      sung: core.length > 0 && coverage >= 0.3 && userMidi !== null,
      coverage,
      userMidi,
      relCents: null,
      absCents: userMidi !== null ? centsBetweenMidi(userMidi, target(n)) : null,
      onsetMs: null,
      levelDb: levels.length >= 3 ? median(levels) : null,
      // Steadiness judges the held part only — the first 0.2 s belong to "note attack".
      stability:
        dur >= 0.55 ? analyseStability(framesIn(frames, n.startTime + 0.2 + lag, n.endTime - 0.06 + lag)) : null,
      clash: null,
      tone: null,
      attack: null,
    }
  })
  const attempted = evals.filter((_e, k) => framesIn(frames, notes[k].startTime, notes[k].endTime).length > 0)
  const sung = evals.filter((e) => e.sung)

  // Key offset: robust median of (user − ref), octave flips folded out.
  let keyOffset: number | null = null
  let octaveFlips = 0
  if (sung.length >= 2) {
    const diffs = sung.map((e) => e.userMidi! - target(notesAll[e.noteIndex]))
    const o0 = median(diffs)
    const folded = diffs.map((d) => {
      const k = Math.round((d - o0) / 12)
      if (k !== 0) octaveFlips++
      return d - 12 * k
    })
    keyOffset = median(folded)
    sung.forEach((e, k) => (e.relCents = (folded[k] - keyOffset!) * 100))
  }

  // Onsets: after a rest, the first voiced frame; inside a legato line, the
  // moment the pitch crosses over from the previous note to this one (in the
  // singer's own key). Repeated same-pitch legato notes have no audible onset.
  const off = keyOffset ?? 0
  for (const e of sung) {
    const n = notesAll[e.noteIndex]
    const prev = notesAll[e.noteIndex - 1]
    const gap = prev ? n.startTime - prev.endTime : Infinity
    const lo = prev ? Math.max(n.startTime - 0.3, prev.endTime + Math.min(gap, 0.3) / 2) : n.startTime - 0.3
    const win = framesIn(frames, gap >= 0.25 ? lo : n.startTime - 0.3, n.startTime + Math.min(0.4, (n.endTime - n.startTime) * 0.6))
    const dist = (m: number, ref: number) => {
      const d = m - (ref + s.transpose + off)
      return Math.abs(d - 12 * Math.round(d / 12))
    }
    if (gap >= 0.25 || !prev) {
      const f = win.find((x) => x.midi !== null)
      if (f) e.onsetMs = (f.t - n.startTime) * 1000
    } else if (Math.abs(prev.midiPitch - n.midiPitch) >= 0.5) {
      for (let k = 0; k + 2 < win.length; k++) {
        const run = win.slice(k, k + 3)
        if (run.every((x) => x.midi !== null && dist(x.midi, n.midiPitch) < dist(x.midi, prev.midiPitch))) {
          e.onsetMs = (run[0].t - n.startTime) * 1000
          break
        }
      }
    }
  }

  // Tone: how periodic (clean) the voice is while singing, measured on frames clearly
  // above the room/backing noise. Breathy, raspy or strained singing is less periodic.
  const quiet = framesIn(frames, from, to).filter((f) => f.midi === null && f.level !== undefined).map((f) => f.level!)
  const noiseFloor = quiet.length >= 20 ? percentile(quiet, 20) : -90
  for (const e of evals) {
    const n = notesAll[e.noteIndex]
    const edge = Math.min(0.06, (n.endTime - n.startTime) * 0.2)
    const core = framesIn(frames, n.startTime + edge + lag, n.endTime - edge + lag)
      .filter((f) => f.level !== undefined && f.level >= noiseFloor + 10)
    if (core.length >= 6) {
      const cl = core.map((f) => f.clarity)
      e.tone = { clarity: median(cl), noisy: cl.filter((c) => c < 0.8).length / cl.length }
    }
  }

  // Attack: on notes that start fresh (after a rest or a real jump), how long until the
  // voice settles on the note (in the singer's key), and whether it scooped up from below.
  const keyOff = keyOffset ?? 0
  for (const e of sung) {
    const n = notesAll[e.noteIndex]
    const prev = notesAll[e.noteIndex - 1]
    const fresh = !prev || n.startTime - prev.endTime >= 0.2 || Math.abs(n.midiPitch - prev.midiPitch) >= 1
    if (!fresh || n.endTime - n.startTime < 0.25) continue
    const v = framesIn(frames, n.startTime + lag - 0.08, n.startTime + lag + Math.min(0.5, (n.endTime - n.startTime) * 0.7))
      .filter((f) => f.midi !== null)
    if (v.length < 6) continue
    const dev = (m: number) => {
      const d = (m - (target(n) + keyOff)) * 100
      return d - 1200 * Math.round(d / 1200)
    }
    let settleMs: number | null = null
    for (let k = 0; k + 2 < v.length; k++) {
      if ([0, 1, 2].every((j) => Math.abs(dev(v[k + j].midi!)) <= s.toleranceCents)) {
        settleMs = (v[k].t - v[0].t) * 1000
        break
      }
    }
    const early = v.filter((f) => f.t - v[0].t < 0.12).map((f) => dev(f.midi!))
    e.attack = { settleMs, scoop: early.length >= 3 && median(early) < -Math.max(s.toleranceCents, 70) }
  }

  // Harmony: does each sung note fit the accompaniment's chord? (when chords are known)
  let checked = 0, clashes = 0
  for (const e of sung) {
    const n = notesAll[e.noteIndex]
    const chord = chordAt(harmony, (n.startTime + n.endTime) / 2)
    if (!chord) continue
    checked++
    e.clash = clashesWith(e.userMidi!, target(n), chord)
    if (e.clash) clashes++
  }
  // in a different key from the music (octaves don't count) — whether or not chords could be checked
  const keyClash = keyOffset !== null && Math.abs(keyOffset - 12 * Math.round(keyOffset / 12)) > 0.5

  const metrics: Record<MetricKey, MetricResult> = {
    shape: shapeMetric(),
    harmony: harmonyMetric(),
    tone: toneMetric(),
    attack: attackMetric(),
    dynamics: dynamicsMetric(),
    rhythm: rhythmMetric(),
    stability: stabilityMetric(),
    exact: exactMetric(),
  }
  // Every score is graded on the same strict curve, so the overall below is just the
  // weighted mean of the scores shown next to it — never lower than all of them.
  for (const m of Object.values(metrics)) if (m.score !== null) m.score = grade(m.score)

  return {
    from,
    to,
    notesTotal: attempted.length,
    notesSung: sung.length,
    keyOffset,
    octaveFlips,
    timeOffsetMs: Math.round(lag * 1000),
    metrics,
    overall: overallScore(metrics, s),
    harmony: { available: checked > 0, checked, clashes, keyClash },
    notes: evals,
  }

  // ---- metric implementations (closures over the measurements above) --------

  function enoughSinging(min = 3): string | null {
    if (!attempted.length) return 'nothing recorded in this range'
    if (sung.length < min || sung.length < attempted.length * 0.4)
      return `sang ${sung.length} of ${attempted.length} notes — not enough to judge`
    return null
  }

  function shapeMetric(): MetricResult {
    const why = enoughSinging()
    if (why) return { score: null, note: why, details: {} }
    let pairs = 0, dirOk = 0
    const intScores: number[] = []
    for (let k = 1; k < sung.length; k++) {
      const a = sung[k - 1], b = sung[k]
      const na = notesAll[a.noteIndex], nb = notesAll[b.noteIndex]
      if (nb.startTime - na.endTime > 1.2 || (na.line !== undefined && na.line !== nb.line)) continue
      const refInt = nb.midiPitch - na.midiPitch
      const userInt = refInt + (b.relCents! - a.relCents!) / 100
      const dir = (x: number) => (Math.abs(x) < 0.5 ? 0 : Math.sign(x))
      pairs++
      if (dir(refInt) === dir(userInt)) dirOk++
      intScores.push(ramp(Math.abs(userInt - refInt) * 100, s.toleranceCents / 2, s.toleranceCents + 100))
    }
    if (pairs < 2) return { score: null, note: 'need at least two connected notes', details: {} }
    const direction = dirOk / pairs
    const intervals = mean(intScores)
    const inTune = sung.filter((e) => Math.abs(e.relCents!) <= s.toleranceCents).length / sung.length
    return {
      score: 0.25 * direction + 0.4 * intervals + 0.35 * inTune,
      note: 'your key and octave are free — only the melody’s shape counts',
      details: {
        direction,
        intervals,
        inKey: inTune,
        pairs,
        keyOffset: keyOffset === null ? null : Math.round(keyOffset * 10) / 10,
        octaveFlips,
      },
    }
  }

  function dynamicsMetric(): MetricResult {
    const why = enoughSinging(4)
    if (why) return { score: null, note: why, details: {} }
    const withRef = sung.filter((e) => notesAll[e.noteIndex].loudness !== undefined)
    if (withRef.length < 4) return { score: null, note: 'no reference loudness for this song (charts don’t carry dynamics)', details: {} }
    const refDb = withRef.map((e) => notesAll[e.noteIndex].loudness!)
    const refStd = Math.sqrt(mean(refDb.map((v) => (v - mean(refDb)) ** 2)))
    if (refStd < 1.5) return { score: null, note: 'the reference is sung at an even level here — nothing to compare', details: {} }

    // Noise floor from unvoiced frames (room noise + backing leakage); only voiced
    // frames clearly above it are trusted. Raw mic gain never matters: everything
    // below is relative to the singer's own median.
    const unvoiced = framesIn(frames, from, to).filter((f) => f.midi === null && f.level !== undefined).map((f) => f.level!)
    const floor = unvoiced.length >= 20 ? percentile(unvoiced, 20) : -90
    const pairs: [number, number][] = []
    for (const e of withRef) {
      const n = notesAll[e.noteIndex]
      const lv = framesIn(frames, n.startTime + lag, n.endTime + lag)
        .filter((f) => f.midi !== null && f.level !== undefined && f.level >= floor + 6)
        .map((f) => f.level!)
      if (lv.length >= 3) pairs.push([median(lv), n.loudness!])
    }
    if (pairs.length < 4)
      return { score: null, note: 'mic signal too close to the background to read dynamics (not a reason to sing louder)', details: { snrDb: null } }
    const u = pairs.map((p) => p[0]), r = pairs.map((p) => p[1])
    const um = median(u), rm = median(r)
    const uRel = u.map((v) => clamp(v - um, -15, 15)), rRel = r.map((v) => v - rm)
    const uStd = Math.sqrt(mean(uRel.map((v) => v * v)))
    const corr = uStd < 0.5 ? 0 : pearson(uRel, rRel)
    const mad = mean(uRel.map((v, i) => Math.abs(v - rRel[i])))

    // Intended soft / powerful sections: groups of notes ≥3 dB from the median.
    let sections = 0, followed = 0
    for (let i = 0; i < rRel.length; i++) {
      if (Math.abs(rRel[i]) < 3) continue
      sections++
      if (Math.sign(uRel[i]) === Math.sign(rRel[i]) && Math.abs(uRel[i]) >= 1.5) followed++
    }
    return {
      score: 0.6 * clamp((corr - 0.2) / 0.65, 0, 1) + 0.4 * ramp(mad, 1.5, 6),
      note: 'compares how your loudness rises and falls, relative to yourself',
      details: {
        correlation: Math.round(corr * 100) / 100,
        avgDiffDb: Math.round(mad * 10) / 10,
        loudSoftFollowed: sections ? followed / sections : null,
        yourRangeDb: Math.round((Math.max(...u) - Math.min(...u)) * 10) / 10,
        refRangeDb: Math.round((Math.max(...r) - Math.min(...r)) * 10) / 10,
        snrDb: Math.round((um - floor) * 10) / 10,
      },
    }
  }

  function rhythmMetric(): MetricResult {
    const why = enoughSinging()
    if (why) return { score: null, note: why, details: {} }
    const onsets = sung.map((e) => e.onsetMs).filter((v): v is number => v !== null)
    if (onsets.length < 3) return { score: null, note: 'could not find note starts', details: {} }
    const onsetScore = mean(onsets.map((ms) => ramp(Math.abs(ms), 60, 220)))

    // Phrase endings (note followed by a ≥0.25 s rest) and the rests themselves.
    const releases: number[] = []
    let pauses = 0, respected = 0
    for (let k = 0; k < notes.length; k++) {
      const n = notes[k]
      const next = notesAll[idx[k] + 1]
      const gap = next ? next.startTime - n.endTime : Infinity
      if (gap < 0.25) continue
      if (evals[k].sung) {
        const tail = framesIn(frames, n.startTime, n.endTime + Math.min(0.5, gap - 0.05)).filter((f) => f.midi !== null)
        if (tail.length) releases.push(ramp(Math.abs(tail[tail.length - 1].t - n.endTime) * 1000, 100, 320))
      }
      if (next && next.startTime <= to && gap >= 0.3) {
        const mid = framesIn(frames, n.endTime + gap * 0.25, next.startTime - gap * 0.25)
        if (mid.length >= 5) {
          pauses++
          if (mid.filter((f) => f.midi !== null).length / mid.length <= 0.3) respected++
        }
      }
    }
    const parts: [number, number][] = [[onsetScore, 0.6]]
    if (releases.length) parts.push([mean(releases), 0.2])
    if (pauses) parts.push([respected / pauses, 0.2])
    const wsum = parts.reduce((a, p) => a + p[1], 0)
    const sorted = [...onsets].sort((a, b) => a - b)
    return {
      score: parts.reduce((a, p) => a + p[0] * p[1], 0) / wsum,
      note: 'small expressive timing differences (< 60 ms) are free',
      details: {
        medianOnsetMs: Math.round(median(onsets)),
        onsetSpreadMs: Math.round(percentile(sorted, 75) - percentile(sorted, 25)),
        onTime: onsets.filter((v) => Math.abs(v) <= 80).length / onsets.length,
        pausesRespected: pauses ? respected / pauses : null,
        overallLagMs: Math.round(lag * 1000),
      },
    }
  }

  function stabilityMetric(): MetricResult {
    const why = enoughSinging(2)
    if (why) return { score: null, note: why, details: {} }
    const st = sung.map((e) => e.stability).filter((x): x is NonNullable<typeof x> => x !== null)
    if (!st.length) return { score: null, note: 'no long notes sung in this range', details: {} }
    const vib = st.filter((x) => x.kind === 'vibrato' || x.kind === 'wobble')
    return {
      score: mean(st.map((x) => x.score)),
      note: 'steadiness on long notes — healthy vibrato is not penalised',
      details: {
        longNotes: st.length,
        steady: st.filter((x) => x.kind === 'steady').length,
        vibrato: st.filter((x) => x.kind === 'vibrato').length,
        wobble: st.filter((x) => x.kind === 'wobble').length,
        unstable: st.filter((x) => x.kind === 'unstable').length,
        jitterCents: Math.round(median(st.map((x) => x.jitterCents))),
        vibratoHz: vib.length ? Math.round(median(vib.map((x) => x.vibratoHz!)) * 10) / 10 : null,
        vibratoCents: vib.length ? Math.round(median(vib.map((x) => x.vibratoCents!))) : null,
      },
    }
  }

  /**
   * In tune with the music: your key must be the song's key or an exact octave of it
   * (a man singing a woman's song an octave down is fine; 5 keys off is not — it clashes
   * with the backing). When the chords are known, your notes must also fit them.
   */
  function harmonyMetric(): MetricResult {
    const why = enoughSinging()
    if (why) return { score: null, note: why, details: {} }
    if (keyOffset === null) return { score: null, note: 'could not tell which key you sang in', details: {} }
    const offCents = Math.abs(keyOffset - 12 * Math.round(keyOffset / 12)) * 100
    const keyFit = ramp(offCents, 25, 80)
    const chordFit = checked >= 3 ? 1 - clashes / checked : null
    return {
      score: chordFit === null ? keyFit : 0.6 * keyFit + 0.4 * chordFit,
      note: 'your key must match the music — an octave up or down is fine',
      details: {
        keyOffset: Math.round(keyOffset * 10) / 10,
        keyFit,
        chordFit,
        clashes,
        checked,
      },
    }
  }

  /**
   * Tone clarity — a proxy for a clean voice: how periodic it is on the notes.
   * Breathy, raspy, hoarse or strained singing scores lower. A noisy room or a poor
   * mic lowers it too, so it can't judge taste or timbre — only clean vs. noisy.
   */
  function toneMetric(): MetricResult {
    const why = enoughSinging()
    if (why) return { score: null, note: why, details: {} }
    const t = sung.map((e) => e.tone).filter((x): x is NonNullable<typeof x> => x !== null)
    if (t.length < 3) return { score: null, note: 'voice too quiet against the background to judge tone', details: {} }
    const per = t.map((x) => 0.6 * clamp((x.clarity - 0.82) / (0.95 - 0.82), 0, 1) + 0.4 * clamp(1 - x.noisy / 0.28, 0, 1))
    return {
      score: mean(per),
      note: 'how clean your voice sounds (breathy or raspy sounds score lower)',
      details: {
        clarity: Math.round(median(t.map((x) => x.clarity)) * 100) / 100,
        noisy: Math.round(mean(t.map((x) => x.noisy)) * 100) / 100,
        notes: t.length,
      },
    }
  }

  /** Note attack: landing cleanly on each note instead of sliding or scooping into it. */
  function attackMetric(): MetricResult {
    const why = enoughSinging()
    if (why) return { score: null, note: why, details: {} }
    const a = sung.map((e) => e.attack).filter((x): x is NonNullable<typeof x> => x !== null)
    if (a.length < 3) return { score: null, note: 'not enough fresh note starts to judge', details: {} }
    const per = a.map((x) => (x.settleMs === null ? 0 : ramp(x.settleMs, 60, 260)) * (x.scoop ? 0.7 : 1))
    const settled = a.map((x) => x.settleMs).filter((v): v is number => v !== null)
    return {
      score: mean(per),
      note: 'landing straight on each note, without sliding up into it',
      details: {
        medianSettleMs: settled.length ? Math.round(median(settled)) : null,
        scoops: a.filter((x) => x.scoop).length,
        neverSettled: a.filter((x) => x.settleMs === null).length,
        notes: a.length,
      },
    }
  }

  function exactMetric(): MetricResult {
    const r = scoreRange(notesAll, frames, from, to, { toleranceCents: s.toleranceCents, minNoteConfidence: s.minNoteConfidence, transpose: s.transpose, minCoverage: 0.25 })
    if (!r.notesTotal || r.pitchAccuracy === null)
      return { score: null, note: enoughSinging() ?? 'nothing sung', details: {} }
    return {
      score: r.accuracy,
      note: 'original pitch and octave (after transpose)',
      details: { hit: r.hit, notes: r.notesTotal, sharp: r.sharp, flat: r.flat, octave: r.octave, missed: r.missed, avgOffCents: r.medianAbsCents === null ? null : Math.round(r.medianAbsCents) },
    }
  }
}

/** The average of the scores shown (exact notes only in exact mode); each counts the same. */
export function overallScore(metrics: Record<MetricKey, MetricResult>, s: EvalSettings): Evaluation['overall'] {
  const used: Partial<Record<MetricKey, number>> = {}
  let wsum = 0
  for (const k of Object.keys(metrics) as MetricKey[]) {
    if (k === 'exact' && !s.exactEnabled) continue
    if (metrics[k].score === null) continue
    used[k] = 1
    wsum += 1
  }
  if (!wsum) return { score: null, weights: {} }
  let score = 0
  for (const k of Object.keys(used) as MetricKey[]) {
    used[k] = used[k]! / wsum
    score += metrics[k].score! * used[k]!
  }
  // Singing out of key with the music counts once: through its own score ("in key")
  // and its weight in this mean — no extra cap on top, so the overall always sits
  // among the scores shown next to it.
  return { score, weights: used }
}

/**
 * The grading curve every score goes through: 95 → 94, 85 → 82, 75 → 71, 65 → 60.
 * Near-perfect singing keeps its marks; middling singing no longer looks like a B.
 */
export function grade(score: number): number {
  return Math.max(0, Math.min(1, score)) ** 1.2
}

// ---- live guidance --------------------------------------------------------------

export interface LiveGuidance {
  pitch: 'higher' | 'lower' | 'on' | null
  cents: number | null
  dynamics: 'softer' | 'more' | null
}

/**
 * Real-time hint. Pitch is relative to the singer's own key in shape mode
 * (or the original in exact mode). Dynamics compare the singer's level to
 * their *own* running median against the reference's relative loudness, and
 * only when the mic signal is clearly above the background.
 */
export function liveGuidance(i: {
  userMidi: number | null
  targetMidi: number | null
  keyOffset: number | null
  exact: boolean
  tolerance: number
  prevPitch: LiveGuidance['pitch']
  userLevelRel: number | null
  refLevelRel: number | null
  levelReliable: boolean
}): LiveGuidance {
  let pitch: LiveGuidance['pitch'] = null
  let cents: number | null = null
  if (i.userMidi !== null && i.targetMidi !== null) {
    let dev = i.userMidi - i.targetMidi
    if (!i.exact) {
      if (i.keyOffset !== null) dev -= i.keyOffset
      dev -= 12 * Math.round(dev / 12) // octave is free in shape mode
    }
    cents = dev * 100
    if (Math.abs(cents) <= 600) {
      const band = i.prevPitch === 'on' ? i.tolerance + 8 : i.tolerance - 4
      pitch = Math.abs(cents) <= band ? 'on' : cents > 0 ? 'lower' : 'higher'
    }
  }
  let dynamics: LiveGuidance['dynamics'] = null
  if (i.levelReliable && i.userLevelRel !== null && i.refLevelRel !== null && Math.abs(i.refLevelRel) >= 3) {
    const d = i.refLevelRel - i.userLevelRel
    if (d >= 5) dynamics = 'more'
    else if (d <= -5) dynamics = 'softer'
  }
  return { pitch, cents, dynamics }
}

export const METRIC_LABELS: Record<MetricKey, string> = {
  harmony: 'in tune with the music',
  tone: 'tone clarity',
  attack: 'note attack',
  shape: 'melody shape',
  dynamics: 'dynamics',
  rhythm: 'rhythm & phrasing',
  stability: 'stability',
  exact: 'exact pitch',
}
