// Word-level lyric timing.
//
// Best: forced alignment of the words to the isolated vocal (analyzer).
// Fallback: an *estimate* that walks the words across the melody's own note
// starts inside each line (roughly one note per syllable) — marked
// 'estimated' so the UI never presents it as exact.

import type { LyricLine, LyricWord, ReferenceNote } from './types'

/** Rough syllable count (vowel groups), at least 1. Works for English and romanised lyrics. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 1
  const groups = w.match(/[aeiouy]+/g)?.length ?? 1
  // silent final e ("time"), but not consonant + "le" ("kettle")
  const silentE = w.length > 3 && w.endsWith('e') && !/[aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w) ? 1 : 0
  return Math.max(1, groups - silentE)
}

/** End of a line's singing window: its own end, or the next timed line's start. */
export function lineEnd(lines: LyricLine[], i: number, fallback = 4): number {
  const l = lines[i]
  const next = lines.slice(i + 1).find((x) => x.start !== null)?.start ?? null
  if (l.end !== null && (next === null || l.end <= next)) return l.end
  return next ?? (l.start ?? 0) + fallback
}

export function estimateWords(line: LyricLine, end: number, notes: ReferenceNote[]): LyricWord[] {
  if (line.start === null) return []
  const tokens = line.text.split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  const text = (k: number) => tokens[k] + (k < tokens.length - 1 ? ' ' : '')
  const syl = tokens.map(syllables)
  const totalSyl = syl.reduce((a, b) => a + b, 0)
  const inLine = notes.filter((n) => n.sung && n.startTime >= line.start! - 0.15 && n.startTime < end - 0.05)

  if (inLine.length >= tokens.length) {
    // Give each word a share of the line's notes proportional to its syllables.
    const out: LyricWord[] = []
    let used = 0
    for (let k = 0; k < tokens.length; k++) {
      const left = tokens.length - k - 1
      const share = Math.round((syl[k] / totalSyl) * inLine.length)
      const take = Math.max(1, Math.min(share, inLine.length - used - left))
      const first = inLine[used], last = inLine[used + take - 1]
      out.push({ start: first.startTime, end: last.endTime, text: text(k) })
      used += take
    }
    // stretch the last word over any leftover notes
    out[out.length - 1].end = Math.max(out[out.length - 1].end, inLine[inLine.length - 1].endTime)
    return out
  }

  // No usable notes: spread over the line's time by syllables (leaving a short tail).
  const span = Math.max(0.3, (end - line.start) * 0.9)
  const out: LyricWord[] = []
  let t = line.start
  for (let k = 0; k < tokens.length; k++) {
    const d = (syl[k] / totalSyl) * span
    out.push({ start: t, end: t + d * 0.92, text: text(k) })
    t += d
  }
  return out
}

/** Make sure every timed line has words (estimating where needed). Lines that already have words are kept. */
export function withWordTiming(lines: LyricLine[], notes: ReferenceNote[]): LyricLine[] {
  return lines.map((l, i) => {
    if (l.start === null || (l.words && l.words.length)) return l
    const words = estimateWords(l, lineEnd(lines, i), notes)
    return words.length ? { ...l, words, wordsSource: 'estimated' as const } : l
  })
}

export type TickerItem =
  | { kind: 'word'; text: string; start: number; end: number; line: number }
  | { kind: 'gap'; start: number; end: number }

/**
 * Flatten timed lines into one stream for the single-line ticker. Pauses of
 * at least `minGap` seconds become 'gap' items (drawn as lines whose length
 * shows how long the pause is). A lead-in gap counts down to the first word.
 */
export function tickerItems(lines: LyricLine[], minGap = 0.35): TickerItem[] {
  const words: Extract<TickerItem, { kind: 'word' }>[] = []
  lines.forEach((l, li) => {
    for (const w of l.words ?? []) words.push({ kind: 'word', text: w.text, start: w.start, end: w.end, line: li })
  })
  words.sort((a, b) => a.start - b.start)
  const out: TickerItem[] = []
  if (words.length && words[0].start > minGap) out.push({ kind: 'gap', start: Math.max(0, words[0].start - 6), end: words[0].start })
  words.forEach((w, i) => {
    out.push(w)
    const next = words[i + 1]
    if (next && next.start - w.end >= minGap) out.push({ kind: 'gap', start: w.end, end: next.start })
  })
  return out
}

/** Index of the item playing at time t (or the last one before it), -1 before the first. */
export function itemAt(items: TickerItem[], t: number): number {
  let lo = 0, hi = items.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].start <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export interface GateOptions {
  /** Seconds of slack around each lyric line — lyric timing is often a little off. */
  margin: number
  /** Only use the lyrics if they cover at least this share of the detected notes. */
  minCoverage: number
}

/**
 * Use the lyrics as a *gentle* hint for where the lead vocal is: notes that sit
 * well outside every lyric line (more than `margin` seconds away) are probably
 * backing vocals, ad-libs or instruments bleeding into the vocal stem, so they're
 * marked offLyrics (hidden, not scored). Notes inside or near a line are never
 * touched, and if the lyrics don't match the melody well overall they're ignored.
 */
export function lyricGate(
  notes: ReferenceNote[],
  lines: LyricLine[],
  opts: GateOptions = { margin: 1.2, minCoverage: 0.6 },
): { notes: ReferenceNote[]; spans: [number, number][] | null } {
  const spans: [number, number][] = []
  for (const l of lines) {
    if (l.start === null) continue
    const w = l.words
    const a = w?.length ? Math.min(l.start, w[0].start) : l.start
    const b = w?.length ? w[w.length - 1].end : l.end ?? a + 4
    spans.push([a - opts.margin, b + opts.margin])
  }
  if (spans.length < 3) return { notes, spans: null }
  spans.sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const sp of spans) {
    const last = merged[merged.length - 1]
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1])
    else merged.push([...sp])
  }
  const inside = (n: ReferenceNote) => merged.some(([a, b]) => n.endTime > a && n.startTime < b)
  const sung = notes.filter((n) => n.sung)
  if (!sung.length || sung.filter(inside).length < sung.length * opts.minCoverage) return { notes, spans: null }
  return { notes: notes.map((n) => (n.sung && !inside(n) ? { ...n, sung: false, offLyrics: true } : n)), spans: merged }
}

export interface LyricRow {
  /** Index into the lyrics array. */
  line: number
  text: string
  /** When this line becomes the middle (current) row. */
  switchAt: number
  /** Words of this line, plus pause lines: a lead-in before the first word and gaps inside the line. */
  items: TickerItem[]
}

/**
 * Lines for the three-row view. A line becomes current when the previous one
 * has finished, or 1.5 s before its first word — whichever is later — and
 * waits with a pause line that fills up until the first word.
 */
export function lyricRows(lines: LyricLine[], minGap = 0.35, leadIn = 1.5): LyricRow[] {
  const timed = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.start !== null && l.words && l.words.length)
    .sort((a, b) => a.l.words![0].start - b.l.words![0].start)
  const rows: LyricRow[] = []
  let prevEnd = 0
  timed.forEach(({ l, i }, k) => {
    const words = l.words!
    const first = words[0].start
    const switchAt = k === 0 ? Math.max(0, first - 6) : Math.max(prevEnd, first - leadIn)
    const items: TickerItem[] = []
    if (first - switchAt >= minGap) items.push({ kind: 'gap', start: switchAt, end: first })
    words.forEach((w, j) => {
      items.push({ kind: 'word', text: w.text, start: w.start, end: w.end, line: i })
      const nx = words[j + 1]
      if (nx && nx.start - w.end >= minGap) items.push({ kind: 'gap', start: w.end, end: nx.start })
    })
    rows.push({ line: i, text: l.text, switchAt, items })
    prevEnd = Math.max(prevEnd, words[words.length - 1].end)
  })
  return rows
}

/** Index of the current row at time t (-1 before the first one becomes current). */
export function rowAt(rows: LyricRow[], t: number): number {
  let ans = -1
  for (let k = 0; k < rows.length; k++) {
    if (rows[k].switchAt <= t) ans = k
    else break
  }
  return ans
}

/**
 * The same line in another script (Hinglish ↔ Hindi ↔ Urdu), keeping its timing.
 * Word for word when the word count matches; otherwise the new words share the
 * line's sung span by length (marked estimated).
 */
export function retextLine(line: LyricLine, text: string): LyricLine {
  const tokens = text.split(/\s+/).filter(Boolean)
  const words = line.words ?? []
  const withSpace = (k: number) => tokens[k] + (k < tokens.length - 1 ? ' ' : '')
  if (!tokens.length || !words.length) return { ...line, text, words: undefined }
  if (tokens.length === words.length) return { ...line, text, words: words.map((w, k) => ({ ...w, text: withSpace(k) })) }
  const from = words[0].start
  const to = words[words.length - 1].end
  const weights = tokens.map((t) => Math.max(1, [...t].length))
  const total = weights.reduce((a, b) => a + b, 0)
  let at = from
  return {
    ...line,
    text,
    wordsSource: 'estimated',
    words: tokens.map((_, k) => {
      const d = ((to - from) * weights[k]) / total
      const w = { start: at, end: at + d, text: withSpace(k) }
      at += d
      return w
    }),
  }
}
