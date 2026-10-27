import { describe, expect, it } from 'vitest'
import { BeatPulse, easeHue, hueForNote, MusicSense } from './disco'

/** 120 bpm: a kick every 0.5 s, quiet in between; 60 frames a second. */
function kicks(seconds: number, bpm = 120) {
  const out: number[] = []
  for (let f = 0; f < seconds * 60; f++) {
    const t = f / 60
    const sinceKick = t % (60 / bpm)
    out.push(0.15 + (sinceKick < 0.06 ? 0.6 : 0))
  }
  return out
}

describe('BeatPulse', () => {
  it('finds each kick of a steady beat', () => {
    const p = new BeatPulse()
    const beats = kicks(8).filter((b) => p.update(b, 1 / 60)).length
    expect(beats).toBeGreaterThanOrEqual(15) // 16 kicks in 8 s
    expect(beats).toBeLessThanOrEqual(17)
  })
  it('flashes on a beat and fades between', () => {
    const p = new BeatPulse()
    const frames = kicks(2)
    let max = 0
    let min = 1
    frames.forEach((b, i) => {
      p.update(b, 1 / 60)
      if (i > 60) {
        max = Math.max(max, p.pulse)
        min = Math.min(min, p.pulse)
      }
    })
    expect(max).toBeGreaterThan(0.8)
    expect(min).toBeLessThan(0.3)
  })
  it('a steady drone is not a beat', () => {
    const p = new BeatPulse()
    let beats = 0
    for (let i = 0; i < 300; i++) if (p.update(0.5, 1 / 60) && i > 30) beats++
    expect(beats).toBe(0)
  })
  it('sides swap on every beat', () => {
    const p = new BeatPulse()
    const sides: number[] = []
    for (const b of kicks(3)) if (p.update(b, 1 / 60)) sides.push(p.side)
    expect(sides.slice(0, 4)).toEqual([1, 0, 1, 0])
  })
})

describe('colour follows the melody', () => {
  it('higher notes are warmer', () => {
    expect(hueForNote(48)).toBe(260)
    expect(hueForNote(78)).toBe(50)
  })
  it('eases the short way round', () => expect(easeHue(350, 10, 0.5)).toBeCloseTo(0, 5))
})

describe('MusicSense: build-ups and drops', () => {
  const frame = (level: number, kick: boolean) => ({ sub: kick ? level + 0.4 : level * 0.5, bass: level, mid: level * 0.6, high: level * 0.4, level })
  function run(segments: [seconds: number, level: number][]) {
    const m = new MusicSense()
    const drops: number[] = []
    let t = 0
    for (const [secs, level] of segments) {
      for (let f = 0; f < secs * 60; f++, t += 1 / 60) {
        const s = m.update(frame(level, t % 0.5 < 0.06), 1 / 60)
        if (s.dropHit) drops.push(Math.round(t * 10) / 10)
      }
    }
    return drops
  }
  it('a quiet verse into a loud chorus is one drop, when it lands', () => {
    const drops = run([[10, 0.12], [10, 0.6]])
    expect(drops.length).toBe(1)
    expect(drops[0]).toBeGreaterThanOrEqual(10)
    expect(drops[0]).toBeLessThan(11.5)
  })
  it('a song that stays loud has no drop', () => expect(run([[20, 0.6]])).toEqual([]))
  it('a gentle swell is not a drop', () => expect(run([[8, 0.3], [8, 0.36]])).toEqual([]))
  it('two drops need time between them', () => expect(run([[8, 0.1], [6, 0.6], [2, 0.1], [6, 0.6]]).length).toBe(1))
})

describe('MusicSense: the big lines', () => {
  /** a verse: soft kick and bass, little on top, the singer quiet; a chorus: everything, singer full voice */
  const verse = (t: number) => ({ sub: (t % 0.5) < 0.06 ? 0.3 : 0.12, bass: 0.2, mid: 0.06, high: 0.03, level: 0.15, vocal: 0.3 })
  const chorus = (t: number) => ({ sub: (t % 0.5) < 0.06 ? 0.8 : 0.4, bass: 0.6, mid: (t % 0.5) > 0.25 && (t % 0.5) < 0.3 ? 0.7 : 0.45, high: 0.4, level: 0.6, vocal: 0.95 })
  function after(parts: [(t: number) => ReturnType<typeof verse>, number][]) {
    const m = new MusicSense()
    let t = 0
    let last = 0
    for (const [fn, secs] of parts) for (let f = 0; f < secs * 60; f++, t += 1 / 60) last = m.update(fn(t), 1 / 60).main
    return last
  }
  it('a chorus with everything playing and the singer at full voice is a big line', () =>
    expect(after([[verse, 10], [chorus, 4]])).toBeGreaterThan(0.75))
  it('a verse is not', () => expect(after([[chorus, 8], [verse, 8]])).toBeLessThan(0.25))
  it('loud music without the singer is not a big line on its own', () =>
    expect(after([[verse, 6], [(t) => ({ ...chorus(t), vocal: 0 }), 4]])).toBeLessThan(0.7))
})
