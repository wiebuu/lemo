// What makes singing along feel good while it happens: the melody lights up where you're
// on it, your dot moves like it has weight and sparks while you hold the note, a note
// you nailed pops, and a streak counts the notes you hit in a row. Drawing only — the
// scores never depend on any of this.

import type { NoteResult, ReferenceNote } from '../lib/types'

/** Stretches of song time (seconds) the singer was on pitch, in order. */
export type Span = { start: number; end: number }

/**
 * Extend the lit stretches with this moment. A gap shorter than `bridge` (a breath of a
 * pitch tracker frame, a consonant) joins up instead of breaking the glow.
 */
export function extendSpans(spans: Span[], t: number, on: boolean, bridge = 0.12): Span[] {
  if (!on) return spans
  const last = spans[spans.length - 1]
  if (last && t >= last.end - 0.01 && t - last.end <= bridge) {
    last.end = t
    return spans
  }
  if (last && t < last.end) return spans // time didn't move on
  spans.push({ start: t - 0.03, end: t })
  return spans
}

/** Notes hit in a row, counting back from the latest note scored. */
export function streakOf(results: Map<number, NoteResult>): number {
  const idx = [...results.keys()].sort((a, b) => a - b)
  let n = 0
  for (let k = idx.length - 1; k >= 0; k--) {
    if (results.get(idx[k])!.status !== 'hit') break
    n++
  }
  return n
}

interface Particle {
  /** song time the particle is pinned to (it scrolls with the music) */
  t: number
  y: number
  ox: number
  oy: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
}

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export class Juice {
  spans: Span[] = []
  private parts: Particle[] = []
  private popped = new Set<number>()
  private lastTime = 0
  private lastTick = 0
  private emit = 0
  private seed = 1
  /** the dot, on a spring */
  private dot: { y: number; v: number } | null = null
  /** 1 right after a note pops, then decays */
  pulse = 0
  streak = 0
  private streakBump = 0
  private lastResults = -1

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  /** Start over: a new take, a seek back, another song. */
  reset() {
    this.spans = []
    this.parts = []
    this.popped.clear()
    this.dot = null
    this.pulse = 0
    this.streak = 0
    this.lastResults = -1
  }

  /**
   * Once per drawn frame, before drawing. Returns the seconds since the last frame
   * (capped: a tab in the background doesn't make everything jump).
   */
  tick(time: number, live: boolean, onPitch: boolean, fresh: boolean): number {
    const now = performance.now()
    const dt = this.lastTick ? Math.min(0.05, Math.max(0, (now - this.lastTick) / 1000)) : 1 / 60
    this.lastTick = now
    if (fresh || time < this.lastTime - 0.3) this.reset()
    this.lastTime = time
    if (live) extendSpans(this.spans, time, onPitch)
    // forget what scrolled far off the left
    while (this.spans.length && this.spans[0].end < time - 12) this.spans.shift()
    this.pulse = Math.max(0, this.pulse - dt * 2.2)
    this.streakBump = Math.max(0, this.streakBump - dt * 3)
    for (const p of this.parts) {
      p.ox += p.vx * dt
      p.oy += p.vy * dt
      p.vy += 140 * dt // a little gravity
      p.vx *= 1 - 1.6 * dt
      p.life -= dt
    }
    this.parts = this.parts.filter((p) => p.life > 0)
    return dt
  }

  /** Where the dot is drawn: it follows your pitch on a spring (a little give, no wobble). */
  dotAt(target: number, dt: number): number {
    if (!this.dot || Math.abs(target - this.dot.y) > 80) this.dot = { y: target, v: 0 }
    const k = 420
    const c = 2 * Math.sqrt(k) * 0.82
    const d = this.dot
    d.v += (k * (target - d.y) - c * d.v) * dt
    d.y += d.v * dt
    return d.y
  }

  /** Sparks off the dot while you hold the note. */
  spark(time: number, y: number, dt: number, color: string, strength: number) {
    if (reduceMotion()) return
    this.emit += dt * (18 + 30 * strength)
    while (this.emit >= 1) {
      this.emit--
      const a = Math.PI * (0.75 + 0.5 * this.rnd()) // mostly backwards, along the line
      const sp = 40 + 70 * this.rnd()
      this.parts.push({ t: time, y, ox: 0, oy: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 - 20, life: 0.5, max: 0.5, size: 1.2 + 1.6 * this.rnd(), color })
    }
  }

  /** New notes you hit: a pop where each one ends. Returns true when one popped. */
  scoreNotes(results: Map<number, NoteResult>, notes: ReferenceNote[], time: number, y: (n: ReferenceNote) => number, color: string): boolean {
    if (results.size === this.lastResults) return false
    this.lastResults = results.size
    const before = this.streak
    this.streak = streakOf(results)
    if (this.streak > before) this.streakBump = 1
    let popped = false
    for (const [i, r] of results) {
      if (r.status !== 'hit' || this.popped.has(i)) continue
      this.popped.add(i)
      const n = notes[i]
      if (!n || n.endTime < time - 2.5) continue // scored late, long scrolled past: no fireworks
      popped = true
      if (reduceMotion()) continue
      const yy = y(n)
      for (let k = 0; k < 14; k++) {
        const a = this.rnd() * Math.PI * 2
        const sp = 60 + 110 * this.rnd()
        this.parts.push({ t: n.endTime, y: yy, ox: 0, oy: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: 0.7, max: 0.7, size: 1.5 + 2 * this.rnd(), color })
      }
      // the ring
      this.parts.push({ t: n.endTime, y: yy, ox: 0, oy: 0, vx: 0, vy: 0, life: 0.45, max: 0.45, size: -1, color })
    }
    if (popped) this.pulse = 1
    return popped
  }

  /** Particles and rings, pinned to the music as it scrolls. */
  draw(ctx: CanvasRenderingContext2D, X: (t: number) => number) {
    if (!this.parts.length) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const p of this.parts) {
      const k = p.life / p.max
      const x = X(p.t) + p.ox
      const y = p.y + p.oy
      if (p.size < 0) {
        // ring: grows and fades
        ctx.strokeStyle = withA(p.color, 0.55 * k)
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(x, y, 6 + 22 * (1 - k * k), 0, Math.PI * 2)
        ctx.stroke()
        continue
      }
      ctx.fillStyle = withA(p.color, 0.85 * k)
      ctx.beginPath()
      ctx.arc(x, y, p.size * (0.6 + 0.4 * k), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  /** "12 in a row", top right — only once there's a streak worth showing. */
  drawStreak(ctx: CanvasRenderingContext2D, w: number, color: string, sub: string, font: string) {
    if (this.streak < 3) return
    const s = 1 + 0.18 * this.streakBump
    ctx.save()
    ctx.translate(w - 14, 16)
    ctx.scale(s, s)
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.font = `600 15px ${font}`
    ctx.fillStyle = color
    ctx.fillText(`${this.streak}`, 0, 0)
    const nw = ctx.measureText(`${this.streak}`).width
    ctx.font = `10px ${font}`
    ctx.fillStyle = sub
    ctx.fillText('in a row ', -nw, 1)
    ctx.restore()
  }
}

function withA(color: string, a: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const n = parseInt(color.slice(1), 16)
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
  }
  return color
}
