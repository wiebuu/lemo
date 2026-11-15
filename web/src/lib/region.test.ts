import { describe, expect, it } from 'vitest'
import { homeLanguage, shelfOrder } from './region'

describe('visitor region', () => {
  it('finds the country from the time zone', () => {
    expect(homeLanguage('Asia/Tokyo', ['en-US'])).toBe('ja')
    expect(homeLanguage('Asia/Jakarta', ['en'])).toBe('id')
    expect(homeLanguage('Asia/Makassar', [])).toBe('id')
    expect(homeLanguage('Europe/Berlin', ['en-GB'])).toBe('de')
    expect(homeLanguage('Asia/Kolkata', ['en-IN'])).toBe('india')
  })
  it('falls back to the browser language, English means none', () => {
    expect(homeLanguage('America/New_York', ['en-US'])).toBeNull()
    expect(homeLanguage('Europe/London', ['en-GB'])).toBeNull()
    expect(homeLanguage('America/Toronto', ['fr-CA'])).toBe('fr')
    expect(homeLanguage('Asia/Dubai', ['hi-IN'])).toBe('india')
    expect(homeLanguage('Asia/Dubai', ['xx'])).toBeNull()
    expect(homeLanguage(undefined, [])).toBeNull()
  })
  it('own language first, then english; India keeps its order', () => {
    expect(shelfOrder('ja')).toEqual(['local', 'english', 'hindi', 'garhwali'])
    expect(shelfOrder(null)).toEqual(['english', 'hindi', 'garhwali'])
    expect(shelfOrder('india')).toEqual(['garhwali', 'hindi', 'english'])
  })
})
