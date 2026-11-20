import { describe, expect, it } from 'vitest'
import { isStaleChunkError } from './staleBuild'

describe('stale build detection', () => {
  it('spots a lazy part that no longer exists (Chrome, Safari, Firefox)', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Disco-1.js'))).toBe(true)
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module'))).toBe(true)
  })
  it('leaves other errors alone', () => expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false))
})

describe('early', () => {
  it('keeps an open song: a missing part stays unopened and a note shows, no reload', async () => {
    const { early, setKeepPage } = await import('./staleBuild')
    let noted = 0
    setKeepPage(() => true, () => noted++)
    const load = early(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/VoiceFxPanel-x.js')))
    const settled = await Promise.race([load().then(() => 'loaded', () => 'threw'), new Promise((r) => setTimeout(() => r('waiting'), 20))])
    expect(settled).toBe('waiting')
    expect(noted).toBe(1)
  })
  it('passes other errors on', async () => {
    const { early, setKeepPage } = await import('./staleBuild')
    setKeepPage(() => true, () => {})
    await expect(early(() => Promise.reject(new Error('boom')))()).rejects.toThrow('boom')
  })
})
