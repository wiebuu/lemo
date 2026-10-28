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
