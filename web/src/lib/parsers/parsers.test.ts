import { describe, expect, it } from 'vitest'
import { parseLrc, toLrc } from './lrc'
import { parseUltraStar } from './ultrastar'

const CHART = `#TITLE:Test Song
#ARTIST:Nobody
#BPM:120
#GAP:1000
: 0 4 0 Hel
: 4 4 2 lo
- 10
* 12 8 4  world
F 22 2 0 hey
E`

describe('UltraStar parser', () => {
  it('parses headers, timing and pitch (0 = C4)', () => {
    const c = parseUltraStar(CHART)
    expect(c.title).toBe('Test Song')
    expect(c.artist).toBe('Nobody')
    // beat = 60 / (120*4) = 0.125 s; gap 1 s
    expect(c.notes[0]).toMatchObject({ startTime: 1, endTime: 1.5, midiPitch: 60, lyric: 'Hel', line: 0, sung: true })
    expect(c.notes[1].midiPitch).toBe(62)
    expect(c.notes[2]).toMatchObject({ startTime: 2.5, midiPitch: 64, line: 1, lyric: ' world' })
    expect(c.notes[3].sung).toBe(false) // freestyle isn't pitch-scored
  })
  it('rejects charts without BPM', () => {
    expect(() => parseUltraStar(': 0 1 0 a')).toThrow(/BPM/)
  })
})

describe('LRC parser', () => {
  it('parses line timestamps and offsets', () => {
    const lines = parseLrc('[ar:x]\n[offset:+500]\n[00:01.50]first\n[00:04.00]second\n[00:06.25][00:10.00]twice')
    expect(lines.map((l) => l.text)).toEqual(['first', 'second', 'twice', 'twice'])
    expect(lines[0].start).toBeCloseTo(1.0)
    expect(lines[0].end).toBeCloseTo(3.5)
    expect(lines[0].verified).toBe(false)
  })
  it('round-trips', () => {
    const lines = parseLrc('[00:01.50]a\n[01:02.25]b')
    expect(parseLrc(toLrc(lines)).map((l) => l.start)).toEqual([1.5, 62.25])
  })
})
