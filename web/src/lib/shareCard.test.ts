import { describe, expect, it } from 'vitest'
import { challengeLink, pct, shareText } from './shareCard'

describe('share card', () => {
  it('links to the same song with the score to beat', () => {
    expect(challengeLink('yt-O_lhqYfa9nI', 0.87423)).toBe('https://lemodysounds.online/?song=yt-O_lhqYfa9nI&beat=87.42')
  })
  it('links to the site when the song can’t be opened by others', () => {
    expect(challengeLink(null, 0.5)).toBe('https://lemodysounds.online')
  })
  it('shows scores with two decimals', () => {
    expect(pct(0.3453)).toBe('34.53%')
    expect(shareText({ title: 'Pasoori', score: 0.9, parts: [], notes: [], frames: [], from: 0, to: 1, songId: null })).toContain('90.00%')
  })
})
