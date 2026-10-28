import { describe, expect, it } from 'vitest'
import { packFrames, unpackFrames, wavOf } from './topTake'

describe('top takes', () => {
  it('packs the pitch line and gets it back', () => {
    const frames = [
      { t: 1.23456, midi: 60.123, clarity: 0.876, level: -20.04 },
      { t: 1.24456, midi: null, clarity: 0.1 },
    ]
    const back = unpackFrames(JSON.parse(JSON.stringify(packFrames(frames))))
    expect(back).toEqual([
      { t: 1.235, midi: 60.12, clarity: 0.88, level: -20 },
      { t: 1.245, midi: null, clarity: 0.1 },
    ])
  })

  it('makes a 16-bit WAV at the lower rate', async () => {
    const s = new Float32Array(48000).fill(0.5)
    const wav = wavOf(s, 48000, 22050)
    const buf = new DataView(await wav.arrayBuffer())
    expect(String.fromCharCode(buf.getUint8(0), buf.getUint8(1), buf.getUint8(2), buf.getUint8(3))).toBe('RIFF')
    expect(buf.getUint32(24, true)).toBe(22050)
    expect(buf.getUint32(40, true)).toBe(22050 * 2) // one second
    expect(buf.getInt16(44 + 1000, true)).toBe(Math.round(0.5 * 32767))
  })
})
