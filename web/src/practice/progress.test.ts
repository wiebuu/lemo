import { describe, expect, it } from 'vitest'
import { mergeProgress } from './progress'

describe('mergeProgress', () => {
  it('keeps every lesson done on either copy, with the better result', () => {
    const phone = { notation: 'sargam' as const, home: 50, voiceSet: true, best: { l1: { acc: 80, stars: 2 }, l2: { acc: 70, stars: 1 } }, updatedAt: 100 }
    const account = { notation: 'solfege' as const, home: 48, voiceSet: false, best: { l1: { acc: 90, stars: 3 }, l3: { acc: 85, stars: 2 } }, updatedAt: 200 }
    const m = mergeProgress(phone, account)
    expect(m.best).toEqual({ l1: { acc: 90, stars: 3 }, l2: { acc: 70, stars: 1 }, l3: { acc: 85, stars: 2 } })
    expect(m.voiceSet).toBe(true)
    // settings from the copy changed last
    expect(m.notation).toBe('solfege')
    expect(m.home).toBe(48)
    expect(m.updatedAt).toBe(200)
  })

  it('takes the other copy when one is missing', () => {
    const a = { home: 50, best: { l1: { acc: 80, stars: 2 } }, updatedAt: 5 }
    expect(mergeProgress(null, a)).toEqual(a)
    expect(mergeProgress(a, null)).toEqual(a)
  })
})
