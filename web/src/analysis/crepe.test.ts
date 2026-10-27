import { describe, expect, it } from 'vitest'
import { binToHz, chunks, decode, frames, toCrepeRate } from './crepe'
import fx from './__fixtures__/crepe.json'

// fixture: torchcrepe's own preprocessing, CREPE "full" output and Viterbi path for 1 s of a sung-like tone
describe('crepe (same as the server)', () => {
  const audio = Float32Array.from(fx.audio)
  it('frames match torchcrepe', () => {
    const f = frames(audio)
    expect(f.count).toBe(fx.count)
    const row = f.data.subarray(40 * 1024, 41 * 1024)
    let maxDiff = 0
    fx.frames0.forEach((v, i) => (maxDiff = Math.max(maxDiff, Math.abs(v - row[i]))))
    expect(maxDiff).toBeLessThan(2e-3)
  })
  it('Viterbi path matches torchcrepe exactly', () => {
    const { f0, periodicity } = decode(Float32Array.from(fx.probs), fx.count)
    const bins = Array.from(f0, (hz) => Math.round((1200 * Math.log2(hz / 10) - 1997.3794084376191) / 20))
    expect(bins).toEqual(fx.bins)
    periodicity.forEach((p, i) => expect(p).toBeCloseTo(fx.periodicity[i], 4))
  })
  it('bin 0 is about 31.7 Hz', () => expect(binToHz(0)).toBeCloseTo(31.7, 0))
  it('chunks like the server: 30 s, short tail rides along', () => {
    expect(chunks(16000 * 65)).toEqual([[0, 480000], [480000, 960000], [960000, 1040000]])
    expect(chunks(16000 * 60.5)).toEqual([[0, 480000], [480000, 968000]])
  })
  it('resampling keeps a tone in tune', () => {
    const n = 44100
    const tone = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 44100))
    const out = toCrepeRate([tone, tone], 44100)
    expect(out.length).toBe(16000)
    let crossings = 0
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++
    expect(crossings).toBeGreaterThanOrEqual(439)
    expect(crossings).toBeLessThanOrEqual(441)
  })
})
