// What makes singing along feel good while it happens: the melody lights up where you're
// on it, your dot moves like it has weight and glows while you hold the note, a note
// you nailed sends out a soft ring, and a streak counts the notes you hit in a row. Drawing only — the
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

/** A note you nailed: a soft ring that opens out where it ended, pinned to the music. */
interface Ring {
  t: number
  y: number
  age: number
  color: string
}

const RING_LIFE = 0.75

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export class Juice {
  spans: Span[] = []
  private rings: Ring[] = []
  private popped = new Set<number>()
  private lastTime = 0
  private lastTick = 0
  /** the dot, on a spring */
  private dot: { y: number; v: number } | null = null
  /** 1 right after a note pops, then decays */
  pulse = 0
  streak = 0
  private streakBump = 0
  private lastResults = -1

  /** Start over: a new take, a seek back, another song. */
  reset() {
    this.spans = []
    this.rings = []
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
    for (const r of this.rings) r.age += dt
    this.rings = this.rings.filter((r) => r.age < RING_LIFE)
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

  /** Something is still moving (a ring opening, the pop fading): draw the next frame too. */
  get busy(): boolean {
    return this.rings.length > 0 || this.pulse > 0 || this.streakBump > 0
  }

  /** New notes you hit: a ring where each one ends. Returns true when one popped. */
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
      this.rings.push({ t: n.endTime, y: y(n), age: 0, color })
    }
    if (popped) this.pulse = 1
    return popped
  }

  /**
   * The rings: each opens out fast and slows down (ease-out), thinning and fading as it
   * goes, with a soft glow where the note ended. Pinned to the music as it scrolls.
   */
  draw(ctx: CanvasRenderingContext2D, X: (t: number) => number) {
    if (!this.rings.length) return
    ctx.save()
    for (const r of this.rings) {
      const k = r.age / RING_LIFE // 0 → 1
      const e = 1 - (1 - k) ** 3
      const fade = (1 - k) ** 2
      const x = X(r.t)
      const glow = 4 + 18 * e
      const g = ctx.createRadialGradient(x, r.y, 0, x, r.y, glow)
      g.addColorStop(0, withA(r.color, 0.28 * fade))
      g.addColorStop(1, withA(r.color, 0))
      ctx.fillStyle = g
      ctx.fillRect(x - glow, r.y - glow, glow * 2, glow * 2)
      ctx.strokeStyle = withA(r.color, 0.7 * fade)
      ctx.lineWidth = 0.6 + 1.6 * (1 - k)
      ctx.beginPath()
      ctx.arc(x, r.y, 5 + 20 * e, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** "12 in a row", top right — only once there's a streak worth showing. */
  drawStreak(ctx: CanvasRenderingContext2D, w: number, color: string, sub: string, font: string) {
    if (this.streak < 3) return
    const s = 1 + 0.14 * this.streakBump ** 2 // eases back down
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
