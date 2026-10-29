// Phrase segmentation, breath suggestions and lyric helpers.

import type { BreathMark, LyricLine, Phrase, ReferenceNote } from './types'

/**
 * Phrases come from the source's line markers when present (charts, demo),
 * otherwise from silences between sung notes.
 */
export function buildPhrases(notes: ReferenceNote[], gap = 0.45, maxLen = 12): Phrase[] {
  const sung = notes.filter((n) => n.sung || n.lyric)
  if (!sung.length) return []
  const phrases: Phrase[] = []
  const hasLines = sung.every((n) => n.line !== undefined)
  let start = sung[0].startTime
  let end = sung[0].endTime
  for (let i = 1; i < sung.length; i++) {
    const n = sung[i]
    const brk = hasLines
      ? n.line !== sung[i - 1].line
      : n.startTime - end >= gap || n.endTime - start > maxLen
    if (brk) {
      phrases.push({ index: phrases.length, start, end })
      start = n.startTime
    }
    end = Math.max(end, n.endTime)
  }
  phrases.push({ index: phrases.length, start, end })
  return phrases
}

export function phraseAt(phrases: Phrase[], t: number): number {
  if (!phrases.length) return -1
  for (let i = 0; i < phrases.length; i++) {
    const next = phrases[i + 1]
    if (!next || t < next.start - 0.25) return i
  }
  return phrases.length - 1
}

/** How early a jump to a phrase starts playing (a short lead-in). */
export const PHRASE_LEAD_IN = 1

/**
 * The phrase "next / previous / again" moves from. Within the lead-in before a phrase
 * (where a jump to it lands) you're already at that phrase — judged by the playhead
 * alone you'd still be in the one before, and "next" would land on the same phrase
 * again and again.
 */
export function phraseForNav(phrases: Phrase[], t: number): number {
  let i = phraseAt(phrases, t)
  while (i >= 0 && phrases[i + 1] && t >= phrases[i + 1].start - PHRASE_LEAD_IN - 0.05) i++
  return i
}

/**
 * Suggested breaths: only at phrase boundaries with a real gap in the melody.
 * Marked 'suggested' so the UI shows them differently from manual marks.
 */
export function suggestBreaths(phrases: Phrase[], minGap = 0.25): BreathMark[] {
  const out: BreathMark[] = []
  for (let i = 0; i + 1 < phrases.length; i++) {
    const gap = phrases[i + 1].start - phrases[i].end
    if (gap >= minGap) {
      out.push({ id: `s${i}`, time: phrases[i].end + Math.min(0.12, gap / 3), kind: 'suggested' })
    }
  }
  return out
}

/** Build lyric lines from chart syllables (UltraStar / demo style). */
export function lyricsFromNotes(notes: ReferenceNote[]): LyricLine[] {
  const lines: LyricLine[] = []
  let cur: LyricLine | null = null
  let curLine: number | undefined = undefined
  for (const n of notes) {
    if (!n.lyric) continue
    if (!cur || n.line !== curLine) {
      cur = { id: `l${lines.length}`, start: n.startTime, end: n.endTime, text: '', words: [], verified: true, wordsSource: 'chart' }
      lines.push(cur)
      curLine = n.line
    }
    cur.words!.push({ start: n.startTime, end: n.endTime, text: n.lyric })
    cur.end = n.endTime
  }
  for (const l of lines) l.text = l.words!.map((w) => w.text).join('').replace(/\s+/g, ' ').trim()
  return lines
}

/** Index of the current timed lyric line (or -1). Untimed lines are ignored. */
export function lyricLineAt(lines: LyricLine[], t: number): number {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].start
    if (s === null) continue
    if (s <= t + 0.15) idx = i
    else break
  }
  return idx
}

export function plainTextToLines(text: string): LyricLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((t, i) => ({ id: `p${i}-${Date.now().toString(36)}`, start: null, end: null, text: t, verified: false }))
}
