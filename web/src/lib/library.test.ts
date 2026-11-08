import { describe, expect, it } from 'vitest'
import { countsLine, inLanguage, languagesIn, shortCount, sortSongs } from './library'

const songs = [
  { id: 'a', lang: 'hi', views: 1_000, sung: 5, addedAt: 3 },
  { id: 'b', lang: 'en', views: 9_000_000, sung: 0, addedAt: 2 },
  { id: 'c', lang: 'hi', views: null, sung: 40, addedAt: 1 },
  { id: 'd', lang: null, views: 1_000, sung: 5, addedAt: 9 },
]

describe('library', () => {
  it('lists only languages that have songs, the most first', () => {
    expect(languagesIn(songs)).toEqual([
      { code: 'hi', name: 'Hindi', count: 2 },
      { code: 'en', name: 'English', count: 1 },
    ])
  })
  it('filters by language (none: everything)', () => {
    expect(inLanguage(songs, 'hi').map((s) => s.id)).toEqual(['a', 'c'])
    expect(inLanguage(songs, null)).toBe(songs)
  })
  it('sorts by YouTube views, by Lemody plays, or keeps Lemody’s order', () => {
    expect(sortSongs(songs, 'popular').map((s) => s.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(sortSongs(songs, 'sung').map((s) => s.id)).toEqual(['c', 'd', 'a', 'b'])
    expect(sortSongs(songs, 'lemody')).toBe(songs)
  })
  it('writes counts the short way', () => {
    expect(shortCount(950)).toBe('950')
    expect(shortCount(1_234)).toBe('1.2K')
    expect(shortCount(45_600_000)).toBe('46M')
    expect(shortCount(2_100_000_000)).toBe('2.1B')
    expect(countsLine({ views: 3_400_000, sung: 12 })).toBe('3.4M views · 12 sung')
    expect(countsLine({ views: null, sung: 0 })).toBe('')
  })
})
