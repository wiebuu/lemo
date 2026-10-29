import { describe, expect, it } from 'vitest'
import { phraseForNav, PHRASE_LEAD_IN } from './phrases'

const phrases = [
  { index: 0, start: 2, end: 6 },
  { index: 1, start: 7, end: 11 },
  { index: 2, start: 12.5, end: 16 },
  { index: 3, start: 20, end: 24 },
]

describe('next phrase', () => {
  it('always moves on: a jump lands in the lead-in, which already counts as that phrase', () => {
    let t = 0
    const visited: number[] = []
    for (let k = 0; k < 5; k++) {
      const idx = Math.min(phrases.length - 1, phraseForNav(phrases, t) + 1)
      visited.push(idx)
      t = phrases[idx].start - PHRASE_LEAD_IN // where the jump lands
    }
    expect(visited).toEqual([1, 2, 3, 3, 3])
  })
  it('in the middle of a phrase, that phrase', () => {
    expect(phraseForNav(phrases, 9)).toBe(1)
    expect(phraseForNav(phrases, 17)).toBe(2)
  })
  it('previous goes back one, not to the same phrase', () => {
    const at = phrases[2].start - PHRASE_LEAD_IN
    expect(phraseForNav(phrases, at) - 1).toBe(1)
  })
})
