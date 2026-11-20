// Lyric timing fitted to the singer's own voice.
//
// The analyzer separates the original vocal from the music and keeps its loudness
// (and pitch) every 20 ms, null wherever the voice is silent. From that we know
// where someone is actually singing. Lyric words are then fitted to it: a line
// that sits a little early or late moves onto the voice, a word's silent edges are
// trimmed off, and a word that lands on silence moves into the singing next to it.
// So a word is never shown as "being sung" while the vocal is silent, and the
// silences become pauses in the lyric view (drawn as dashes counting down).
//
// Done in the browser, not on the server: every analysed song already carries this
// envelope, so old songs get it without re-analysis, and it re-runs whenever the
// lyrics change (new lyrics, the singer's own edits, another script).

import type { LoudnessEnvelope, LyricLine, LyricWord, PitchContour } from './types'
import { syllables } from './lyricTiming'

export type Span = [number, number]

export interface VoiceOptions {
  /** Ignore frames this many dB under the typical sung level (faint bleed from the music). */
  floorDb: number
  /** Silences shorter than this are inside the singing (consonants, quick breaths). */
  bridge: number
  /** Voiced blips shorter than this are dropped. */
  minLen: number
}

const VOICE: VoiceOptions = { floorDb: -30, bridge: 0.3, minLen: 0.12 }

/**
 * Stretches where the separated vocal is sounding, from the reference's loudness
 * envelope (or its pitch contour), sorted and non-overlapping.
 */
export function voicedSpans(env: LoudnessEnvelope | PitchContour | undefined, opts: Partial<VoiceOptions> = {}): Span[] {
  if (!env) return []
  const o = { ...VOICE, ...opts }
  const vals = 'db' in env ? env.db : env.midi
  const loud = 'db' in env
  const raw: Span[] = []
  let from = -1
  for (let i = 0; i <= vals.length; i++) {
    const v = i < vals.length ? vals[i] : null
    const on = v !== null && (!loud || v > o.floorDb)
    if (on && from < 0) from = i
    if (!on && from >= 0) {
      raw.push([env.t0 + from * env.hop, env.t0 + i * env.hop])
      from = -1
    }
  }
  const merged: Span[] = []
  for (const s of raw) {
    const last = merged[merged.length - 1]
    if (last && s[0] - last[1] < o.bridge) last[1] = s[1]
    else merged.push([s[0], s[1]])
  }
  return merged.filter(([a, b]) => b - a >= o.minLen)
}

/** First span ending after t (binary search). */
function firstAfter(voice: Span[], t: number): number {
  let lo = 0, hi = voice.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (voice[mid][1] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The voiced pieces inside [a, b]. */
export function voicedIn(voice: Span[], a: number, b: number): Span[] {
  const out: Span[] = []
  for (let k = firstAfter(voice, a); k < voice.length && voice[k][0] < b; k++) {
    const s = Math.max(a, voice[k][0]), e = Math.min(b, voice[k][1])
    if (e > s) out.push([s, e])
  }
  return out
}

/** Seconds of voice inside [a, b]. */
export function voicedTime(voice: Span[], a: number, b: number): number {
  let sum = 0
  for (const [s, e] of voicedIn(voice, a, b)) sum += e - s
  return sum
}

export interface AlignOptions {
  /** How far a whole line may move onto the voice (s). Forced-aligned lines move less. */
  maxShift: number
  maxShiftAligned: number
  /** A word may start this much before the voice (its consonant). */
  lead: number
  /** Only fit a song whose words already sit on voice at least this much overall: below it the voice tracking missed the singer (rap, whispering), so it's left alone. */
  minCoverage: number
}

const ALIGN: AlignOptions = { maxShift: 1.0, maxShiftAligned: 0.5, lead: 0.05, minCoverage: 0.5 }
const STEP = 0.02
const MIN_WORD = 0.06
/** A silence this long inside a word ends it (the rest belongs to other words). */
const SPLIT = 0.5
const LONG_WORD = 1.2

const wordsVoiced = (voice: Span[], ws: LyricWord[], by = 0) => ws.reduce((a, w) => a + voicedTime(voice, w.start + by, w.end + by), 0)
const wordsLength = (ws: LyricWord[]) => ws.reduce((a, w) => a + Math.max(0, w.end - w.start), 0)
const round = (t: number) => Math.round(t * 1000) / 1000

/**
 * Fit timed words to the voiced stretches. Lines confirmed by a person, or from a
 * chart, are kept exactly. A line the voice can't account for (no singing near it)
 * is kept as it was rather than guessed.
 */
export function alignToVoice(lines: LyricLine[], voice: Span[], opts: Partial<AlignOptions> = {}): LyricLine[] {
  const o = { ...ALIGN, ...opts }
  if (!voice.length) return lines
  const all = lines.flatMap((l) => l.words ?? [])
  const total = wordsLength(all)
  if (total < 3 || wordsVoiced(voice, all) < total * o.minCoverage) return lines

  const order = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.words?.length)
    .sort((a, b) => a.l.words![0].start - b.l.words![0].start)
  const out = lines.slice()
  let prevEnd = -Infinity
  order.forEach(({ l, i }, k) => {
    const words = l.words!
    if (l.verified || l.wordsSource === 'chart') {
      prevEnd = Math.max(prevEnd, words[words.length - 1].end)
      return
    }
    const nextStart = order[k + 1]?.l.words![0].start ?? Infinity
    const fitted = fitLine(words, voice, l.wordsSource === 'aligned' ? o.maxShiftAligned : o.maxShift, prevEnd, nextStart, o.lead)
    if (fitted) {
      const by = fitted.shift
      out[i] = {
        ...l,
        start: l.start === null ? null : round(l.start + by),
        end: l.end === null ? null : round(l.end + by),
        words: fitted.words,
      }
    }
    const w = out[i].words!
    prevEnd = Math.max(prevEnd, w[w.length - 1].end)
  })
  return out
}

/** One line's words fitted to the voice, or null to keep the line as it is. */
function fitLine(words: LyricWord[], voice: Span[], maxShift: number, prevEnd: number, nextStart: number, lead: number): { words: LyricWord[]; shift: number } | null {
  const dur = wordsLength(words)
  if (dur <= 0) return null
  const first = words[0].start, last = words[words.length - 1].end

  // 1. the whole line onto the voice, when that clearly covers more of it
  const base = wordsVoiced(voice, words)
  let shift = 0
  if (base < dur * 0.9) {
    let best = base
    const steps = Math.round(maxShift / STEP)
    for (let s = -steps; s <= steps; s++) {
      const by = s * STEP
      if (first + by < prevEnd - 0.05 || last + by > nextStart + 0.05) continue
      const v = wordsVoiced(voice, words, by)
      if (v > best + 1e-6 || (Math.abs(v - best) < 1e-6 && Math.abs(by) < Math.abs(shift))) {
        best = v
        shift = by
      }
    }
    if (best - base < Math.max(0.1 * dur, 0.1)) shift = 0
  }
  const moved = words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }))
  const trim = (w: LyricWord): LyricWord | null => {
    const sung = trimToVoice(voice, w.start, w.end)
    if (!sung) return null
    const s = Math.max(w.start, sung[0] - lead, prevEnd)
    return { ...w, start: s, end: Math.max(sung[1], s + MIN_WORD) }
  }
  // Hardly any singing under this line: the voice tracking may have missed it (rap,
  // whispering), so the words stay — only a word held on over a long silence is cut back.
  if (wordsVoiced(voice, moved) < dur * 0.25) {
    let changed = false
    const kept = words.map((w) => {
      if (w.end - w.start < LONG_WORD) return w
      const t = trim(w)
      if (!t) return w
      changed = true
      return { ...t, start: round(t.start), end: round(t.end) }
    })
    return changed ? { words: kept, shift: 0 } : null
  }

  // 2. each word's silent edges off; note the words that land on silence
  const fit: (LyricWord | null)[] = moved.map(trim)

  // 3. words on silence: into free singing next to them, else they share a neighbour's
  for (let j = 0; j < fit.length; j++) {
    if (fit[j]) continue
    let r = j
    while (r + 1 < fit.length && !fit[r + 1]) r++
    const before = fit.slice(0, j).reverse().find(Boolean) ?? null
    const after = fit.slice(r + 1).find(Boolean) ?? null
    const from = Math.max(before ? before.end : moved[j].start - 0.6, prevEnd)
    const to = after ? after.start : Math.min(moved[r].end + 0.6, nextStart)
    const run = moved.slice(j, r + 1)
    // the longest stretch of singing between the neighbours that no word holds
    const free = (to > from ? voicedIn(voice, from, to) : []).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0]
    if (free && free[1] - free[0] >= MIN_WORD * run.length) {
      spread(run, free[0], free[1]).forEach((w, q) => (fit[j + q] = w))
    } else if (before || after) {
      // share the nearest sung word's time, by syllables
      const host = before ?? after!
      const hi = fit.indexOf(host)
      const group = before ? [host, ...run] : [...run, host]
      const shared = spread(group, host.start, host.end)
      shared.forEach((w, q) => (fit[before ? hi + q : j + q] = w))
    } else return null
    j = r
  }

  // 4. in order, never overlapping
  const res = fit as LyricWord[]
  for (let j = 0; j < res.length; j++) {
    const p = res[j - 1]
    const w = { ...res[j], start: p ? Math.max(res[j].start, p.end) : res[j].start }
    w.end = Math.max(w.end, w.start + 0.02)
    res[j] = { ...w, start: round(w.start), end: round(w.end) }
  }
  return { words: res, shift }
}

/**
 * The sung part of [a, b]: its voiced pieces, up to the first silence of SPLIT
 * seconds or more (a word's start is surer than its end) — unless that first
 * part is a small piece of the word's voice, then the largest part. null when silent.
 */
export function trimToVoice(voice: Span[], a: number, b: number): Span | null {
  const pieces = voicedIn(voice, a, b)
  const sung = pieces.reduce((x, [s, e]) => x + e - s, 0)
  if (!pieces.length || sung < Math.min(MIN_WORD, 0.3 * (b - a))) return null
  const groups: { span: Span; sung: number }[] = []
  for (const [s, e] of pieces) {
    const g = groups[groups.length - 1]
    if (g && s - g.span[1] < SPLIT) {
      g.span[1] = e
      g.sung += e - s
    } else groups.push({ span: [s, e], sung: e - s })
  }
  const pick = groups[0].sung >= 0.3 * sung ? groups[0] : groups.reduce((x, y) => (y.sung > x.sung ? y : x))
  return pick.span
}

/** Lay words over [a, b] in order, each taking a share by syllables. */
function spread(words: LyricWord[], a: number, b: number): LyricWord[] {
  const syl = words.map((w) => syllables(w.text))
  const sum = syl.reduce((x, y) => x + y, 0)
  let t = a
  return words.map((w, q) => {
    const d = ((b - a) * syl[q]) / sum
    const out = { ...w, start: t, end: t + d }
    t += d
    return out
  })
}
