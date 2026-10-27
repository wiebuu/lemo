// Disco lights: the beat comes from the music itself (sudden jumps in the low end —
// kick and bass — against its recent level), the colour from the singer's melody.

export class BeatPulse {
  private avg = 0
  private peak = 0.05
  private since = 1
  /** 0..1: flashes to 1 on a beat, then fades */
  pulse = 0
  /** which side is brighter: swaps on every beat */
  side = 0

  /** Feed one frame: `bass` 0..1, `dt` seconds since the last frame. Returns true on a beat. */
  update(bass: number, dt: number): boolean {
    this.since += dt
    const rise = bass - this.avg
    this.avg += (bass - this.avg) * Math.min(1, dt * 6) // ~0.17 s memory
    this.peak = Math.max(this.peak * Math.exp(-dt / 4), rise, 0.05)
    this.pulse *= Math.exp(-dt / 0.22)
    // a clear jump (relative to how hard this song hits) and not straight after the last one
    const beat = rise > 0.04 && rise > this.peak * 0.45 && this.since > 0.22
    if (beat) {
      this.pulse = Math.min(1, 0.55 + rise / this.peak * 0.45)
      this.side = 1 - this.side
      this.since = 0
    }
    return beat
  }
}

/** Low notes → cool violet/blue, high notes → warm amber/pink: the light follows the line. */
export function hueForNote(midi: number): number {
  const x = Math.max(0, Math.min(1, (midi - 48) / 30)) // C3 … F#5
  return (260 + x * 150) % 360
}

/** Ease a hue towards another the short way round the colour wheel. */
export function easeHue(from: number, to: number, k: number): number {
  const d = ((to - from + 540) % 360) - 180
  return (from + d * Math.min(1, k) + 360) % 360
}

export interface Bands {
  sub: number
  bass: number
  mid: number
  high: number
  level: number
  /** the singer, 0..1: how loud this line is sung against the rest of the song (0 = not singing) */
  vocal?: number
}

export interface Presence {
  sub: number
  bass: number
  mid: number
  high: number
  vocal: number
}

export interface Sense {
  /** kick (sub-bass) hit: flashes to 1, fades fast */
  kick: number
  /** snare / clap hit (mids) */
  snare: number
  /** hi-hat (highs): short */
  hat: number
  /** true on the frame a kick / snare / hat lands */
  kickHit: boolean
  snareHit: boolean
  hatHit: boolean
  /** how loud the song is now against its own loudest, 0..1 (smooth) */
  energy: number
  /** rising energy before a drop, 0..1 */
  build: number
  /** a big drop: 1 when it lands, fading over ~4 s */
  drop: number
  dropHit: boolean
  /** counts kicks (beams and colours step on it) */
  beat: number
  /** how present each kind of sound is right now, 0..1 (each against its own loudest in this song) */
  presence: Presence
  /**
   * 0..1: one of the song's big lines — most sounds playing and the singer at full
   * voice (a chorus, the hook). Rises in about half a second, settles over two.
   */
  main: number
}

/**
 * Listens to the music frame by frame and turns it into what the lights show:
 * separate hits for kick / snare / hats, how energetic the song is right now, a
 * build-up as energy climbs, and a "drop" when the last second is suddenly much
 * louder than the four before it (only near the song's loudest, at most every 12 s).
 */
export class MusicSense {
  private kickD = new BeatPulse()
  private snareD = new BeatPulse()
  private hatD = new BeatPulse()
  private hist: { t: number; v: number }[] = []
  private t = 0
  private fast = 0
  private peak = 0.2
  private lastDrop = -Infinity
  private beats = 0
  drop = 0
  hat = 0
  private peaks = { sub: 0.1, bass: 0.1, mid: 0.1, high: 0.1 }
  private pres: Presence = { sub: 0, bass: 0, mid: 0, high: 0, vocal: 0 }
  private mainRaw = 0

  update(b: Bands, dt: number): Sense {
    this.t += dt
    const kickHit = this.kickD.update(b.sub, dt)
    const snareHit = this.snareD.update(b.mid, dt)
    // hats: short taps, so their own quick fade
    const hatHit = this.hatD.update(b.high, dt)
    this.hat = hatHit ? 1 : this.hat * Math.exp(-dt / 0.08)
    if (kickHit) this.beats++

    this.fast += (b.level - this.fast) * Math.min(1, dt * 3)
    this.peak = Math.max(this.peak * Math.exp(-dt / 30), this.fast, 0.05)
    this.hist.push({ t: this.t, v: b.level })
    while (this.hist.length && this.hist[0].t < this.t - 5) this.hist.shift()
    const avg = (from: number, to: number) => {
      let s = 0, n = 0
      for (const h of this.hist) if (h.t >= this.t - from && h.t < this.t - to) { s += h.v; n++ }
      return n ? s / n : 0
    }
    const now = avg(1, 0)
    const before = avg(5, 1)
    const energy = Math.min(1, this.fast / this.peak)
    const build = before > 0 ? Math.max(0, Math.min(1, (now / before - 1) / 0.5)) : 0
    let dropHit = false
    if (this.t > 5 && before > 0.02 && now > before * 1.5 && this.fast > this.peak * 0.7 && this.t - this.lastDrop > 12) {
      dropHit = true
      this.lastDrop = this.t
      this.drop = 1
    } else this.drop *= Math.exp(-dt / 1.6)

    // each kind of sound against its own loudest so far in this song
    for (const k of ['sub', 'bass', 'mid', 'high'] as const) {
      this.peaks[k] = Math.max(this.peaks[k] * Math.exp(-dt / 60), b[k], 0.04)
      const now = Math.min(1, b[k] / this.peaks[k])
      this.pres[k] += (now - this.pres[k]) * Math.min(1, dt * 3)
    }
    this.pres.vocal += ((b.vocal ?? 0) - this.pres.vocal) * Math.min(1, dt * 4)
    const on = (x: number) => Math.max(0, Math.min(1, (x - 0.35) / 0.4)) // clearly playing
    const fullness = (on(this.pres.sub) + on(this.pres.bass) + on(this.pres.mid) + on(this.pres.high)) / 4
    const raw = 0.3 * energy + 0.35 * fullness + 0.35 * this.pres.vocal
    // quick to rise, slow to settle: a big line stays big for its whole length
    this.mainRaw += (raw - this.mainRaw) * Math.min(1, dt * (raw > this.mainRaw ? 2 : 0.5))
    const x = Math.max(0, Math.min(1, (this.mainRaw - 0.42) / 0.33))
    const main = x * x * (3 - 2 * x)

    return {
      kick: this.kickD.pulse, snare: this.snareD.pulse, hat: this.hat,
      kickHit, snareHit, hatHit, energy, build, drop: this.drop, dropHit, beat: this.beats,
      presence: { ...this.pres }, main,
    }
  }
}
