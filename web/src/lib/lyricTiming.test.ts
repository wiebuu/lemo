import { describe, expect, it } from 'vitest'
import { estimateWords, itemAt, lyricGate, lyricRows, retextLine, rowAt, syllables, tickerItems, withWordTiming } from './lyricTiming'
import type { LyricLine, ReferenceNote } from './types'

const line = (start: number | null, text: string, end: number | null = null): LyricLine => ({ id: text, start, end, text, verified: false })
const note = (s: number, e: number): ReferenceNote => ({ startTime: s, endTime: e, midiPitch: 60, confidence: 1, sung: true })

describe('syllables', () => {
  it('counts vowel groups', () => {
    expect(syllables('morning')).toBe(2)
    expect(syllables('light')).toBe(1)
    expect(syllables('kettle')).toBe(2)
    expect(syllables('ring')).toBe(1)
    expect(syllables('mohabbat')).toBe(3)
    expect(syllables('…')).toBe(1)
  })
})

describe('estimateWords', () => {
  it('walks words across the line’s notes, one note per syllable', () => {
    const notes = [note(1, 1.4), note(1.5, 1.9), note(2, 2.4), note(2.5, 3)]
    const w = estimateWords(line(1, 'morning light now'), 3.5, notes)
    expect(w.map((x) => x.text)).toEqual(['morning ', 'light ', 'now'])
    expect(w[0]).toMatchObject({ start: 1, end: 1.9 }) // 2 syllables → 2 notes
    expect(w[1]).toMatchObject({ start: 2, end: 2.4 })
    expect(w[2]).toMatchObject({ start: 2.5, end: 3 })
  })
  it('falls back to spreading by syllables when there are no notes', () => {
    const w = estimateWords(line(10, 'one two three'), 13, [])
    expect(w).toHaveLength(3)
    expect(w[0].start).toBe(10)
    expect(w[2].end).toBeLessThan(13)
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBeGreaterThanOrEqual(w[i - 1].end)
  })
  it('never invents timing for untimed lines', () => {
    expect(estimateWords(line(null, 'no time'), 5, [])).toEqual([])
  })
  it('keeps existing word timing and marks estimates', () => {
    const exact: LyricLine = { ...line(0, 'a b'), words: [{ start: 0, end: 0.5, text: 'a ' }, { start: 0.6, end: 1, text: 'b' }] }
    const out = withWordTiming([exact, line(2, 'c d', 3)], [])
    expect(out[0]).toBe(exact)
    expect(out[1].wordsSource).toBe('estimated')
  })
})

describe('ticker stream', () => {
  const lines: LyricLine[] = [
    { ...line(2, 'hi there'), words: [{ start: 2, end: 2.4, text: 'hi ' }, { start: 2.45, end: 3, text: 'there' }] },
    { ...line(4, 'again'), words: [{ start: 4, end: 4.8, text: 'again' }] },
  ]
  it('inserts pauses as gaps, including a lead-in', () => {
    const items = tickerItems(lines)
    expect(items.map((i) => i.kind)).toEqual(['gap', 'word', 'word', 'gap', 'word'])
    expect(items[3]).toMatchObject({ kind: 'gap', start: 3, end: 4 })
  })
  it('finds the current item', () => {
    const items = tickerItems(lines)
    expect(itemAt(items, 0)).toBe(0)
    expect(itemAt(items, 2.5)).toBe(2)
    expect(itemAt(items, 3.5)).toBe(3)
  })
})

describe('lyric gate (gentle)', () => {
  const ln = (start: number, end: number): LyricLine => ({ ...line(start, 'la la', end) })
  const lines = [ln(10, 14), ln(16, 20), ln(30, 34), ln(36, 40)]
  const notes = [note(10, 11), note(12, 13), note(17, 18), note(31, 32), note(37, 38), note(24, 25), note(20.8, 21.5)]
  it('hides notes far from any lyric line, keeps the rest', () => {
    const { notes: out, spans } = lyricGate(notes, lines)
    expect(spans).not.toBeNull()
    expect(out.find((n) => n.startTime === 24)!.offLyrics).toBe(true) // 4 s from any line
    expect(out.find((n) => n.startTime === 24)!.sung).toBe(false)
    expect(out.find((n) => n.startTime === 20.8)!.offLyrics).toBeUndefined() // within the 1.2 s slack
    expect(out.filter((n) => n.sung)).toHaveLength(6)
  })
  it('ignores lyrics that don\u2019t match the melody', () => {
    const elsewhere = [ln(100, 104), ln(110, 114), ln(120, 124)]
    const { notes: out, spans } = lyricGate(notes, elsewhere)
    expect(spans).toBeNull()
    expect(out).toBe(notes)
  })
  it('needs at least a few timed lines', () => {
    expect(lyricGate(notes, [ln(10, 14)]).spans).toBeNull()
  })
})

describe('three-row lyric lines', () => {
  const lines: LyricLine[] = [
    { ...line(2, 'hi there'), words: [{ start: 2, end: 2.4, text: 'hi ' }, { start: 3, end: 3.5, text: 'there' }] },
    { ...line(8, 'again'), words: [{ start: 8, end: 8.8, text: 'again' }] },
    { ...line(9, 'now'), words: [{ start: 9, end: 9.5, text: 'now' }] },
  ]
  const rows = lyricRows(lines)
  it('switches lines when the previous ends or 1.5 s before the next, whichever is later', () => {
    expect(rows.map((r) => r.switchAt)).toEqual([0, 6.5, 8.8])
  })
  it('adds a lead-in pause line and pauses inside a line', () => {
    expect(rows[0].items.map((i) => i.kind)).toEqual(['gap', 'word', 'gap', 'word'])
    expect(rows[2].items.map((i) => i.kind)).toEqual(['word']) // only 0.2 s wait: no pause line
  })
  it('finds the current row', () => {
    expect(rowAt(rows, 1)).toBe(0)
    expect(rowAt(rows, 7)).toBe(1)
    expect(rowAt(rows, 9)).toBe(2)
  })
})

describe('retextLine (lyrics in another script)', () => {
  const line = {
    id: 'l', start: 1, end: 3, text: 'मुझको इतना बताए', verified: false, wordsSource: 'aligned' as const,
    words: [{ start: 1, end: 1.5, text: 'मुझको ' }, { start: 1.5, end: 2, text: 'इतना ' }, { start: 2, end: 3, text: 'बताए' }],
  }
  it('keeps each word\'s timing when the word count matches', () => {
    const r = retextLine(line, 'Mujhko itna bataye')
    expect(r.words!.map((w) => [w.text, w.start, w.end])).toEqual([['Mujhko ', 1, 1.5], ['itna ', 1.5, 2], ['bataye', 2, 3]])
    expect(r.wordsSource).toBe('aligned')
  })
  it('spreads a different number of words over the sung span', () => {
    const r = retextLine(line, 'one two')
    expect(r.words!.length).toBe(2)
    expect(r.words![0].start).toBe(1)
    expect(r.words![1].end).toBeCloseTo(3)
    expect(r.wordsSource).toBe('estimated')
  })
})
