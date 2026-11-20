import { describe, expect, it } from 'vitest'
import { alignToVoice, trimToVoice, voicedSpans, voicedTime, type Span } from './voiceAlign'
import type { LoudnessEnvelope, LyricLine, LyricWord } from './types'

/** A 20 ms loudness envelope that is sounding (0 dB) inside `spans`, silent (null) elsewhere. */
function envelope(spans: Span[], dur: number, db = 0): LoudnessEnvelope {
  const hop = 0.02
  const out: (number | null)[] = []
  for (let k = 0; k < Math.round(dur / hop); k++) {
    const t = k * hop + 1e-9
    out.push(spans.some(([a, b]) => t >= a && t < b) ? db : null)
  }
  return { t0: 0, hop, db: out }
}
const w = (start: number, end: number, text: string): LyricWord => ({ start, end, text })
const line = (words: LyricWord[], extra: Partial<LyricLine> = {}): LyricLine => ({
  id: words.map((x) => x.text).join(''),
  start: words[0].start,
  end: words[words.length - 1].end,
  text: words.map((x) => x.text).join(''),
  words,
  verified: false,
  wordsSource: 'aligned',
  ...extra,
})
const near = (a: number, b: number, tol = 0.03) => Math.abs(a - b) <= tol
/** Seconds of a line's words that sit on silence. */
const silent = (l: LyricLine, voice: Span[]) => (l.words ?? []).reduce((s, x) => s + (x.end - x.start) - voicedTime(voice, x.start, x.end), 0)

describe('voicedSpans', () => {
  it('finds where the vocal sounds, bridging short gaps (consonants) and dropping blips', () => {
    const env = envelope([[1, 2], [2.2, 3], [5, 5.06], [6, 8]], 10)
    const v = voicedSpans(env)
    expect(v).toHaveLength(2)
    expect(near(v[0][0], 1) && near(v[0][1], 3)).toBe(true) // 0.2 s gap bridged
    expect(near(v[1][0], 6) && near(v[1][1], 8)).toBe(true) // 60 ms blip dropped
  })
  it('ignores faint bleed far below the sung level', () => {
    expect(voicedSpans(envelope([[1, 3]], 5, -40))).toEqual([])
  })
  it('has nothing for a song without a vocal envelope', () => {
    expect(voicedSpans(undefined)).toEqual([])
  })
  it('follows an offset envelope', () => {
    const env = { ...envelope([[1, 2]], 4), t0: 0.5 }
    const v = voicedSpans(env)
    expect(near(v[0][0], 1.5) && near(v[0][1], 2.5)).toBe(true)
  })
})

describe('trimToVoice', () => {
  const voice: Span[] = [[5, 6.5], [20, 20.5]]
  it('cuts a word held on over a long silence back to its first singing', () => {
    expect(trimToVoice(voice, 4.9, 25.7)).toEqual([5, 6.5])
  })
  it('takes the larger part when the first is only a small piece of it', () => {
    expect(trimToVoice([[5, 5.2], [20, 23]], 4.9, 25.7)).toEqual([20, 23])
  })
  it('is null for a word on silence', () => {
    expect(trimToVoice(voice, 10, 11)).toBeNull()
  })
})

describe('alignToVoice', () => {
  // a song: intro silent to 10 s, two sung lines, a break 16–30 s, a last line
  const voice: Span[] = [[10, 12], [12.5, 15.5], [30, 33]]
  const song = (): LyricLine[] => [
    line([w(10, 10.8, 'hello '), w(10.8, 12, 'there')]),
    line([w(12.5, 14, 'how '), w(14, 16.5, 'are you')]), // held on a second into the break
    line([w(29.4, 30.6, 'come '), w(30.6, 32.4, 'back')], { wordsSource: 'estimated' }), // 0.6 s early
    line([w(40, 41, 'filler')]), // nobody sings here
  ]

  it('never shows a word as sung while the vocal is silent', () => {
    const out = alignToVoice(song(), voice)
    for (const l of out.slice(0, 3)) expect(silent(l, voice)).toBeLessThan(0.06) // at most a consonant's lead
  })
  it('trims a word held on into the break back to the singing', () => {
    const out = alignToVoice(song(), voice)
    expect(near(out[1].words![1].end, 15.5)).toBe(true)
  })
  it('moves an early line onto the voice, keeping its line timing in step', () => {
    const out = alignToVoice(song(), voice)
    expect(out[2].words![0].start).toBeGreaterThanOrEqual(29.94)
    expect(near(out[2].start!, out[2].words![0].start, 0.06)).toBe(true)
  })
  it('keeps words in order and never overlapping', () => {
    const all = alignToVoice(song(), voice).flatMap((l) => l.words!)
    for (let k = 1; k < all.length; k++) {
      expect(all[k].start).toBeGreaterThanOrEqual(all[k - 1].end - 1e-9)
      expect(all[k].end).toBeGreaterThan(all[k].start)
    }
  })
  it('leaves a line with no singing near it as the lyrics have it', () => {
    const lines = song()
    expect(alignToVoice(lines, voice)[3]).toBe(lines[3])
  })
  it('moves a word that landed on silence into the free singing next to it', () => {
    const v: Span[] = [[1, 2], [2.6, 3.4], [5, 7]]
    const out = alignToVoice([line([w(1, 2, 'one '), w(2.05, 2.5, 'two '), w(2.6, 3.4, 'three')]), line([w(5, 7, 'la')])], v)
    // "two" sat in the silent 2–2.6 s: it shares "one"'s singing, never the silence
    expect(silent(out[0], v)).toBeLessThan(0.06)
    expect(out[0].words!.map((x) => x.text)).toEqual(['one ', 'two ', 'three'])
  })
  it('keeps lines a person confirmed, and chart lines, exactly', () => {
    const lines = [line([w(9, 12, 'mine')], { verified: true }), line([w(16, 17, 'chart')], { wordsSource: 'chart' }), ...song()]
    const out = alignToVoice(lines, voice)
    expect(out[0]).toBe(lines[0])
    expect(out[1]).toBe(lines[1])
  })
  it('leaves a song alone when the voice tracking clearly missed the singer (e.g. rap)', () => {
    const lines = [line([w(0, 5, 'spoken words here')]), line([w(6, 12, 'more spoken words')])]
    expect(alignToVoice(lines, [[11, 11.5]])).toBe(lines)
  })
  it('changes nothing without a vocal envelope', () => {
    const lines = song()
    expect(alignToVoice(lines, [])).toBe(lines)
  })
})
