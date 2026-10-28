// Canvas renderer for the scrolling pitch graph. Called once per animation
// frame by the studio loop — React never re-renders for audio frames.

import { discoLive } from '../lib/discoState'
import { midiToNoteName, isNatural, formatTime } from '../lib/music'
import { noteAt } from '../lib/scoring'
import { cleanVoice, foldOctaveSlips, placeOnMelody, runStart } from '../lib/voiceLine'
import type { LiveState } from '../lib/scoring'
import type { LoopRegion } from '../lib/timeline'
import type { BreathMark, LoudnessEnvelope, NoteResult, Phrase, PitchContour, ReferenceNote, UserFrame } from '../lib/types'
import type { GraphLayers, LineDetail, MelodyView } from '../state/persist'
import type { NoteReview } from '../lib/review'

export interface GraphView {
  time: number
  duration: number
  notes: ReferenceNote[]
  transpose: number
  contour?: PitchContour
  /** Results: the sung section; everything outside it fades to a faint outline. */
  focus?: { start: number; end: number } | null
  /** After a test: how wrong each note was (red shading), keyed by note index. */
  review?: Map<number, NoteReview>
  /** When set, the detailed contour is only drawn inside these (lyric-backed) spans. */
  voiceSpans?: [number, number][]
  frames: UserFrame[]
  ghost: UserFrame[]
  results: Map<number, NoteResult>
  breaths: BreathMark[]
  loop: LoopRegion | null
  tempo?: number
  firstBeat?: number
  beatsPerBar: number
  pxPerSec: number
  semitoneSpan: number
  showGrid: boolean
  showNoteNames: boolean
  melodyView: MelodyView
  lineDetail: LineDetail
  tolerance: number
  live: { midi: number | null; target: number | null; state: LiveState; cents: number | null }
  layers: GraphLayers
  /** Exact-pitch scoring mode (colours notes by absolute deviation). */
  exact: boolean
  /** Singer's key offset in semitones; used to normalise the shape line. */
  keyOffset: number | null
  phrases: Phrase[]
  refLoudness?: LoudnessEnvelope
  refLoudMedian: number
  /** Singer's own median level (dB) — loudness is always drawn relative to it. */
  levelBase: number | null
}

interface Palette {
  bg: string; main: string; main2: string; voice: string; sub: string; subAlt: string; text: string; error: string; sharp: string; flat: string
}

export const PLAYHEAD = 0.5

export class GraphRenderer {
  private ctx: CanvasRenderingContext2D
  private w = 0
  private h = 0
  private dpr = 1
  private center = 64
  private p: Palette = readPalette()
  private font = '"Roboto Mono", ui-monospace, monospace'
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  /** Something outside the view changed (size, theme): draw on the next frame even if the view didn't. */
  stale = true

  refreshTheme() {
    this.p = readPalette()
    this.stale = true
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = w
    this.h = h
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.stale = true
  }

  /** Song time under an x coordinate (for click-to-seek). */
  timeAtX(x: number, v: Pick<GraphView, 'time' | 'pxPerSec'>): number {
    return v.time + (x - this.w * PLAYHEAD) / v.pxPerSec
  }

  draw(v: GraphView) {
    const { ctx, w, h, p } = this
    if (!w || !h) return
    this.stale = false
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const bottomPad = 18
    const laneH = v.layers.loudness ? Math.max(36, Math.round((h - bottomPad) * 0.2)) : 0
    const plotH = h - bottomPad - (laneH ? laneH + 8 : 0)
    const px = w * PLAYHEAD
    const t0 = v.time - px / v.pxPerSec
    const t1 = v.time + (w - px) / v.pxPerSec
    const X = (t: number) => px + (t - v.time) * v.pxPerSec

    // Follow the melody vertically (smoothly).
    let lo = Infinity, hi = -Infinity
    for (const n of v.notes) {
      if (n.endTime < t0 - 2 || n.startTime > t1 + 2) continue
      lo = Math.min(lo, n.midiPitch + v.transpose)
      hi = Math.max(hi, n.midiPitch + v.transpose)
    }
    if (lo === Infinity && v.live.midi !== null) lo = hi = v.live.midi
    if (lo !== Infinity) {
      const target = (lo + hi) / 2
      this.center += (target - this.center) * (Math.abs(target - this.center) > 18 ? 1 : 0.06)
    }
    const span = Math.max(v.semitoneSpan, lo === Infinity ? 0 : hi - lo + 4)
    const sp = plotH / span
    const Y = (m: number) => plotH / 2 - (m - this.center) * sp

    // Loop region
    if (v.loop) {
      ctx.fillStyle = withAlpha(p.subAlt, discoLive.on ? 0.45 : 0.9)
      ctx.fillRect(X(v.loop.start), 0, (v.loop.end - v.loop.start) * v.pxPerSec, plotH)
      ctx.fillStyle = withAlpha(p.main, 0.5)
      ctx.fillRect(X(v.loop.start) - 1, 0, 2, plotH)
      ctx.fillRect(X(v.loop.end) - 1, 0, 2, plotH)
    }

    // Pitch grid
    const mLo = Math.floor(this.center - span / 2) - 1
    const mHi = Math.ceil(this.center + span / 2) + 1
    if (v.showGrid) {
      for (let m = mLo; m <= mHi; m++) {
        const y = Math.round(Y(m)) + 0.5
        const isC = ((m % 12) + 12) % 12 === 0
        const a = (isC ? 0.28 : isNatural(m) ? 0.1 : 0.05) * edgeFade(y, plotH)
        if (a < 0.004) continue
        ctx.strokeStyle = this.fadeAcross(w, p.sub, a)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }
    }

    // Time grid
    ctx.font = `10px ${this.font}`
    ctx.textBaseline = 'alphabetic'
    if (v.tempo) {
      const beat = 60 / v.tempo
      const first = Math.ceil((t0 - (v.firstBeat ?? 0)) / beat)
      for (let b = first; (v.firstBeat ?? 0) + b * beat < t1; b++) {
        const t = (v.firstBeat ?? 0) + b * beat
        if (t < 0) continue
        const bar = ((b % v.beatsPerBar) + v.beatsPerBar) % v.beatsPerBar === 0
        if (!bar && beat * v.pxPerSec < 18) continue
        const a = (bar ? 0.22 : 0.08) * edgeFade(X(t), w)
        if (a >= 0.004) {
          ctx.fillStyle = this.fadeDown(plotH, p.sub, a)
          ctx.fillRect(Math.round(X(t)), 0, 1, plotH)
        }
        if (bar) {
          ctx.fillStyle = withAlpha(p.sub, 0.7)
          ctx.fillText(String(Math.floor(b / v.beatsPerBar) + 1), X(t) + 3, h - 5)
        }
      }
    } else {
      const step = v.pxPerSec > 90 ? 1 : 5
      for (let t = Math.ceil(t0 / step) * step; t < t1; t += step) {
        if (t < 0) continue
        const major = t % 5 === 0
        const a = (major ? 0.2 : 0.07) * edgeFade(X(t), w)
        if (a >= 0.004) {
          ctx.fillStyle = this.fadeDown(plotH, p.sub, a)
          ctx.fillRect(Math.round(X(t)), 0, 1, plotH)
        }
        if (major) {
          ctx.fillStyle = withAlpha(p.sub, 0.7)
          ctx.fillText(formatTime(t), X(t) + 3, h - 5)
        }
      }
    }

    // Song end
    if (v.duration > 0 && v.duration < t1) {
      ctx.fillStyle = withAlpha(p.bg, 0.6)
      ctx.fillRect(X(v.duration), 0, w, h)
    }

    // Phrase boundaries (timing layer)
    if (v.layers.timing) {
      ctx.setLineDash([2, 5])
      ctx.strokeStyle = withAlpha(p.sub, 0.35)
      ctx.lineWidth = 1
      for (const ph of v.phrases) {
        for (const t of [ph.start, ph.end]) {
          if (t < t0 || t > t1) continue
          ctx.beginPath()
          ctx.moveTo(Math.round(X(t)) + 0.5, 12)
          ctx.lineTo(Math.round(X(t)) + 0.5, plotH)
          ctx.stroke()
        }
      }
      ctx.setLineDash([])
    }

    // Breath marks
    for (const b of v.breaths) {
      if (b.time < t0 || b.time > t1) continue
      const x = X(b.time)
      ctx.strokeStyle = withAlpha(b.kind === 'manual' ? p.main : p.sub, b.kind === 'manual' ? 0.45 : 0.3)
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(x + 0.5, 12)
      ctx.lineTo(x + 0.5, plotH)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(x - 4, 2)
      ctx.lineTo(x + 4, 2)
      ctx.lineTo(x, 9)
      ctx.closePath()
      if (b.kind === 'manual') {
        ctx.fillStyle = p.main
        ctx.fill()
      } else {
        ctx.strokeStyle = p.sub
        ctx.stroke()
      }
    }

    // Reference melody: one smooth line (default), the detailed contour, or note bars.
    // smooth = the easy note line; natural/detailed = the original singer's real
    // pitch when the song was analysed (charts and the demo only have notes).
    if (v.melodyView === 'bars') this.drawBars(v, X, Y, t0, t1, sp)
    else if (v.lineDetail !== 'smooth' && v.contour) this.drawContour(v, X, Y, t0, t1, plotH)
    else this.drawRefLine(v, X, Y, t0, t1, sp, plotH)

    // Singer: one smoothed line in the accent colour. Shape = shifted into the
    // song's key; exact = true pitch (faded when both are shown).
    const showShape = v.layers.shape
    const showExact = v.layers.exact
    if (showShape || showExact) this.drawUser(v.ghost, v, X, Y, t0, t1, 'ghost', showShape)
    if (showExact) this.drawUser(v.frames, v, X, Y, t0, t1, showShape ? 'faded' : 'main', false)
    const head = showShape || showExact ? this.drawUser(v.frames, v, X, Y, t0, t1, 'main', showShape) : null

    // Playhead + live dot (at the smoothed current pitch)
    const ph = ctx.createLinearGradient(0, 0, 0, plotH)
    ph.addColorStop(0, withAlpha(p.main, 0.5))
    ph.addColorStop(1, withAlpha(p.main2, 0.15))
    ctx.fillStyle = ph
    ctx.fillRect(Math.round(px) - 1, 0, 2, plotH)
    if (head && v.time - head.t < 0.15 && v.time - head.t > -0.05) {
      ctx.fillStyle = p.voice
      ctx.beginPath()
      ctx.arc(px, head.y, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = withAlpha(p.bg, 0.9)
      ctx.lineWidth = 2
      ctx.stroke()
    }

    if (laneH) this.drawLoudness(v, X, t0, t1, plotH + 8, laneH)
    this.fadeSides(plotH)
    if (v.focus) this.fadeOutside(X(v.focus.start), X(v.focus.end), h)

    // Note names gutter
    if (v.showNoteNames) {
      ctx.font = `10px ${this.font}`
      ctx.textBaseline = 'middle'
      for (let m = mLo; m <= mHi; m++) {
        const isC = ((m % 12) + 12) % 12 === 0
        if (!isNatural(m) || (sp < 10 && !isC)) continue
        const y = Y(m)
        if (y < 6 || y > plotH - 6) continue
        ctx.fillStyle = withAlpha(isC ? p.text : p.sub, isC ? 0.7 : 0.75)
        ctx.fillText(midiToNoteName(m), 6, y)
      }
    }
  }

  /**
   * Fade everything left of x0 and right of x1, with soft 28 px edges — by making it
   * see-through rather than painting the background over it, so whatever is behind
   * the graph (the disco lights) still shows.
   */
  private fadeOutside(x0: number, x1: number, h: number) {
    const { ctx, w } = this
    const edge = 28
    const veil = 'rgba(0,0,0,0.82)'
    const clear = 'rgba(0,0,0,0)'
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    if (x0 > 0) {
      ctx.fillStyle = veil
      ctx.fillRect(0, 0, Math.max(0, x0 - edge), h)
      const g = ctx.createLinearGradient(x0 - edge, 0, x0, 0)
      g.addColorStop(0, veil)
      g.addColorStop(1, clear)
      ctx.fillStyle = g
      ctx.fillRect(x0 - edge, 0, edge, h)
    }
    if (x1 < w) {
      const g = ctx.createLinearGradient(x1, 0, x1 + edge, 0)
      g.addColorStop(0, clear)
      g.addColorStop(1, veil)
      ctx.fillStyle = g
      ctx.fillRect(x1, 0, edge, h)
      ctx.fillStyle = veil
      ctx.fillRect(x1 + edge, 0, w, h)
    }
    ctx.restore()
  }

  /** The lines fade out towards the graph's left and right edges (like the grid). */
  private fadeSides(plotH: number) {
    const { ctx, w } = this
    const edge = Math.min(70, w * 0.07)
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    for (const [x0, x1] of [[0, edge], [w, w - edge]] as const) {
      const g = ctx.createLinearGradient(x0, 0, x1, 0)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(Math.min(x0, x1), 0, edge, plotH)
    }
    ctx.restore()
  }

  /**
   * Results review: repaint each note's stretch of the melody line in red — the
   * more wrong, the darker/stronger the red (scale set by the difficulty).
   */
  private paintReview(path: Path2D, v: GraphView, X: (t: number) => number, t0: number, t1: number, plotH: number, width: number) {
    if (!v.review) return
    const { ctx, p } = this
    for (const [i, r] of v.review) {
      const n = v.notes[i]
      if (!n || r.severity === null || r.severity <= 0.02 || n.endTime < t0 || n.startTime > t1) continue
      ctx.save()
      ctx.beginPath()
      ctx.rect(X(n.startTime), 0, Math.max(1, X(n.endTime) - X(n.startTime)), plotH)
      ctx.clip()
      ctx.lineCap = 'round'
      ctx.strokeStyle = withAlpha(p.error, 0.25 + 0.75 * r.severity)
      ctx.lineWidth = width + 1.5 * r.severity
      if (r.missed) ctx.setLineDash([4, 5])
      ctx.stroke(path)
      ctx.restore()
    }
  }

  /**
   * Paint the stretch of an already-built path just behind the playhead in the
   * highlight colour, fading out over ~1 s — the same line, never a second one.
   */
  private paintTrail(path: Path2D, px: number, pxPerSec: number, plotH: number, width: number) {
    const { ctx, p } = this
    const len = Math.min(px, Math.max(60, pxPerSec * 1.1))
    const g = ctx.createLinearGradient(px - len, 0, px, 0)
    g.addColorStop(0, withAlpha(p.text, 0))
    g.addColorStop(0.55, withAlpha(p.text, 0.55))
    g.addColorStop(1, p.text)
    ctx.save()
    ctx.beginPath()
    ctx.rect(px - len, 0, len + 1, plotH)
    ctx.clip()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = g
    ctx.lineWidth = width
    ctx.stroke(path)
    ctx.restore()
  }

  /** The reference as one continuous line: held pitches joined by smooth glides; breaks at rests. */
  /** A horizontal line's colour that fades out at the left and right edges. */
  private fadeAcross(w: number, color: string, a: number): CanvasGradient {
    const g = this.ctx.createLinearGradient(0, 0, w, 0)
    g.addColorStop(0, withAlpha(color, 0))
    g.addColorStop(0.1, withAlpha(color, a))
    g.addColorStop(0.9, withAlpha(color, a))
    g.addColorStop(1, withAlpha(color, 0))
    return g
  }

  /** A vertical line's colour that fades out at the top and bottom. */
  private fadeDown(h: number, color: string, a: number): CanvasGradient {
    const g = this.ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, withAlpha(color, 0))
    g.addColorStop(0.14, withAlpha(color, a))
    g.addColorStop(0.86, withAlpha(color, a))
    g.addColorStop(1, withAlpha(color, 0))
    return g
  }

  /**
   * The original singer's line. With disco lights on it takes their colours — a
   * gradient across the screen — and glows: gently most of the time, strongly on the
   * song's big lines.
   */
  private strokeSinger(path: Path2D, alpha: number) {
    const { ctx, p } = this
    if (!discoLive.on) {
      ctx.strokeStyle = withAlpha(p.text, alpha)
      ctx.stroke(path)
      return
    }
    const h = discoLive.hue
    const m = discoLive.main ** 2 // a gentle glow most of the time; the big lines only really shine
    const g = ctx.createLinearGradient(0, 0, this.w, 0)
    g.addColorStop(0, `hsla(${h},90%,${68 + 8 * m}%,0.95)`)
    g.addColorStop(0.5, `hsla(${(h + 45) % 360},92%,${70 + 8 * m}%,1)`)
    g.addColorStop(1, `hsla(${(h + 95) % 360},90%,${68 + 8 * m}%,0.95)`)
    ctx.save()
    ctx.shadowColor = `hsla(${(h + 30) % 360},95%,60%,${0.35 + 0.6 * m})`
    ctx.shadowBlur = 3 + 20 * m
    ctx.strokeStyle = g
    ctx.stroke(path)
    ctx.restore()
  }

  /**
   * A line drawn like a neon tube: its colour glowing around it, and a bright,
   * almost white core. One colour, from the theme.
   */
  private neon(stroke: () => void, color: string, glow: number) {
    const { ctx } = this
    const width = ctx.lineWidth
    ctx.save()
    ctx.shadowColor = withAlpha(color, 0.9)
    ctx.shadowBlur = glow
    ctx.strokeStyle = withAlpha(color, 0.95)
    stroke()
    ctx.shadowBlur = 0
    ctx.lineWidth = Math.max(1, width * 0.42)
    ctx.strokeStyle = mix(color, '#ffffff', 0.65)
    stroke()
    ctx.restore()
  }

  private drawRefLine(v: GraphView, X: (t: number) => number, Y: (m: number) => number, t0: number, t1: number, sp: number, plotH: number) {
    const { ctx, p } = this
    const notes = v.notes
    const y = (n: ReferenceNote) => Y(n.midiPitch + v.transpose)
    const joined = (a: ReferenceNote, b: ReferenceNote) =>
      b.startTime - a.endTime < 0.3 && (a.line === undefined || a.line === b.line)
    const path = new Path2D()
    let first = notes.findIndex((n) => n.endTime >= t0 - 1)
    if (first < 0) first = notes.length
    const vis = (k: number, dir: 1 | -1) => {
      for (let j = k + dir; j >= 0 && j < notes.length; j += dir) if (!notes[j].offLyrics) return notes[j]
      return undefined
    }
    // The line as points (each note's flat part; a passing note too short to hold is one
    // point, so it becomes a rounded bump, not a needle), then drawn with the same rounded
    // corner everywhere: clean steps, flat held notes, nothing jagged.
    const runs: { x: number; y: number }[][] = []
    let pts: { x: number; y: number }[] = []
    const end = () => {
      if (pts.length > 1) runs.push(pts)
      pts = []
    }
    for (let i = first; i < notes.length && notes[i].startTime <= t1 + 1; i++) {
      const n = notes[i]
      if (n.offLyrics) continue
      const prev = vis(i, -1)
      const next = vis(i, 1)
      const dur = n.endTime - n.startTime
      const jp = !!prev && joined(prev, n)
      const jn = !!next && joined(n, next)
      if (!jp && !jn && dur < 0.1) continue // a stray scrap, not a sung note
      if (!jp) end()
      const g = Math.min(0.08, dur * 0.3) // the glide into / out of the note
      if (jp && jn && dur < 0.13) pts.push({ x: X((n.startTime + n.endTime) / 2), y: y(n) })
      else pts.push({ x: X(n.startTime + (jp ? g : 0)), y: y(n) }, { x: X(n.endTime - (jn ? g : 0)), y: y(n) })
      if (!jn) end()
    }
    end()
    const R = 7
    for (const r of runs) {
      path.moveTo(r[0].x, r[0].y)
      for (let k = 1; k < r.length - 1; k++) {
        const a = r[k - 1], b = r[k], c = r[k + 1]
        const rad = Math.min(R, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2)
        if (rad < 0.5 || (a.y === b.y && b.y === c.y)) path.lineTo(b.x, b.y)
        else path.arcTo(b.x, b.y, c.x, c.y, rad)
      }
      path.lineTo(r[r.length - 1].x, r[r.length - 1].y)
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 4
    this.strokeSinger(path, 0.5)

    // The sung part lights up just behind the playhead and fades out —
    // it glides forward with the music instead of jumping note to note.
    if (v.review) this.paintReview(path, v, X, t0, t1, plotH, 4.5)
    else this.paintTrail(path, X(v.time), v.pxPerSec, plotH, 4.5)

    ctx.font = `11px ${this.font}`
    ctx.textBaseline = 'bottom'
    for (let i = first; i < notes.length && notes[i].startTime <= t1; i++) {
      const n = notes[i]
      if (n.offLyrics) continue
      const active = v.time >= n.startTime && v.time < n.endTime
      this.drawOnset(v, n, i, X, y(n) + 8)
      if (n.lyric && sp >= 7) {
        const txt = n.lyric.trim()
        if (txt) {
          ctx.fillStyle = active ? p.text : withAlpha(p.sub, 0.95)
          ctx.fillText(txt, X(n.startTime), y(n) - 8)
        }
      }
    }
  }

  /** The original singer's actual pitch (analysed songs), at the chosen level of detail. */
  private drawContour(v: GraphView, X: (t: number) => number, Y: (m: number) => number, t0: number, t1: number, plotH: number) {
    const { ctx } = this
    const c = v.contour!
    const path = new Path2D()
    const i0 = Math.max(0, Math.floor((t0 - c.t0) / c.hop) - 4)
    const i1 = Math.min(c.midi.length, Math.ceil((t1 - c.t0) / c.hop) + 4)
    let run: { x: number; m: number }[] = []
    const flush = () => {
      if (run.length > 1) {
        const ms = v.lineDetail === 'detailed' ? run.map((r) => r.m) : smooth(run.map((r) => r.m), 'natural')
        path.moveTo(run[0].x, Y(ms[0]))
        for (let k = 1; k < run.length; k++) path.lineTo(run[k].x, Y(ms[k]))
      }
      run = []
    }
    const spans = v.voiceSpans
    let si = 0
    const inSpan = (t: number) => {
      if (!spans) return true
      while (si < spans.length && spans[si][1] < t) si++
      return si < spans.length && spans[si][0] <= t
    }
    for (let i = i0; i < i1; i++) {
      const m = c.midi[i]
      if (m === null || !inSpan(c.t0 + i * c.hop)) {
        flush()
        continue
      }
      run.push({ x: X(c.t0 + i * c.hop), m: m + v.transpose })
    }
    flush()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = 3
    this.strokeSinger(path, 0.5)
    const ni = noteAt(v.notes, v.time)
    if (v.review) this.paintReview(path, v, X, t0, t1, plotH, 3.5)
    else if (ni >= 0 || v.notes.length) this.paintTrail(path, X(v.time), v.pxPerSec, plotH, 3.5)
  }

  private drawBars(v: GraphView, X: (t: number) => number, Y: (m: number) => number, t0: number, t1: number, sp: number) {
    const { ctx, p } = this
    const nh = Math.max(4, Math.min(sp * 0.62, 14))
    ctx.font = `11px ${this.font}`
    ctx.textBaseline = 'bottom'
    v.notes.forEach((n, i) => {
      if (n.offLyrics || n.endTime < t0 || n.startTime > t1) return
      const x = X(n.startTime)
      const nw = Math.max(2, (n.endTime - n.startTime) * v.pxPerSec - 1)
      const y = Y(n.midiPitch + v.transpose)
      const active = v.time >= n.startTime && v.time < n.endTime
      const r = v.results.get(i)
      const rv = v.review?.get(i)
      ctx.fillStyle = rv && rv.severity !== null && rv.severity > 0.02 ? withAlpha(p.error, 0.25 + 0.75 * rv.severity)
        : active ? p.text : r?.status === 'hit' ? withAlpha(p.text, 0.8) : withAlpha(p.sub, 0.55)
      roundRect(ctx, x, y - nh / 2, nw, nh, nh / 2)
      ctx.fill()
      this.drawOnset(v, n, i, X, y + nh / 2 + 3)
      if (n.lyric && sp >= 7) {
        const txt = n.lyric.trim()
        if (txt && ctx.measureText(txt).width < nw + 24) {
          ctx.fillStyle = active ? p.text : withAlpha(p.sub, 0.95)
          ctx.fillText(txt, x, y - nh / 2 - 3)
        }
      }
    })
  }

  /** Timing layer: a small bracket from the note start to where you actually came in. */
  private drawOnset(v: GraphView, n: ReferenceNote, i: number, X: (t: number) => number, y: number) {
    const r = v.results.get(i)
    if (!v.layers.timing || r?.onsetDelta == null || !n.sung) return
    const { ctx, p } = this
    const ms = r.onsetDelta * 1000
    const ox = X(n.startTime + r.onsetDelta)
    ctx.strokeStyle = Math.abs(ms) <= 80 ? withAlpha(p.text, 0.5) : ms > 0 ? p.sharp : p.flat
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(X(n.startTime), y)
    ctx.lineTo(ox, y)
    ctx.moveTo(ox, y - 3)
    ctx.lineTo(ox, y + 3)
    ctx.stroke()
  }

  /**
   * Draw the singer's line, smoothed for display (median 5 → moving average 9,
   * ≈ ±45 ms) and drawn with curves. Scoring always uses the unsmoothed data.
   * In shape mode each voiced run is shifted by the singer's key offset and one
   * consistent octave, so the line never jumps mid-phrase.
   * Returns the last drawn point (for the live dot).
   */
  private drawUser(
    frames: UserFrame[],
    v: GraphView,
    X: (t: number) => number,
    Y: (m: number) => number,
    t0: number,
    t1: number,
    style: 'main' | 'faded' | 'ghost',
    normalised: boolean,
  ): { t: number; y: number } | null {
    if (!frames.length) return null
    const { ctx, p } = this
    // 'faded' (your exact pitch under the shape line) is a faint thin guide: two strong
    // lines nearly on top of each other read as one messy line
    ctx.lineWidth = style === 'main' ? 3.5 : style === 'faded' ? 1.5 : 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // your voice has its own colour, never the original singer's
    if (style === 'main') ctx.strokeStyle = p.voice
    else ctx.strokeStyle = withAlpha(p.sub, style === 'faded' ? 0.28 : 0.35)
    let last: { t: number; y: number } | null = null

    const runs: UserFrame[][] = []
    let run: UserFrame[] = []
    // A short dropout (a consonant, a breath, the tracker missing a frame) doesn't cut the
    // line: it carries on across gaps up to 0.15 s when the pitch on both sides matches.
    // Drawing only — scoring still sees the gap.
    // from the true start of the stretch at the left edge, so the past never shifts as it scrolls
    for (let i = runStart(frames, lowerBoundT(frames, t0 - 0.2)); i < frames.length; i++) {
      const f = frames[i]
      if (f.t > t1) break
      if (f.midi === null) continue
      const last = run[run.length - 1]
      if (last && (f.t - last.t > 0.15 || (f.t - last.t > 0.03 && Math.abs(f.midi - last.midi!) > 2.5))) {
        runs.push(run)
        run = []
      }
      run.push(f)
    }
    if (run.length) runs.push(run)

    // pitch per stretch (shifted onto the melody in "shape" view)
    const series = runs
      .filter((r) => {
        const dur = r[r.length - 1].t - r[0].t
        if (r.length < 3 || dur < 0.1) return false // shorter is a blip, not singing
        // in the melody view, a short sound where the original sings nothing is a breath or the room
        if (normalised && dur < 0.25) return v.notes.some((n) => n.endTime > r[0].t && n.startTime < r[r.length - 1].t)
        return true
      })
      .map((r) => {
        let vals = r.map((f) => f.midi!)
        if (normalised) {
          // onto the melody, in its octave (see placeOnMelody: the octave choice is sticky)
          const mid = r[r.length >> 1]
          const ni = noteAt(v.notes, mid.t)
          const runAnchor = ni >= 0 ? v.notes[ni].midiPitch + v.transpose : this.center
          const anchors = r.map((f) => {
            const nj = noteAt(v.notes, f.t)
            return nj >= 0 ? v.notes[nj].midiPitch + v.transpose : runAnchor
          })
          vals = placeOnMelody(vals, anchors, v.keyOffset ?? 0)
        }
        return { r, vals }
      })
    for (const { r, vals: raw } of series) {
      let vals = raw
      if (!normalised) {
        // real pitch: fold single frames that slip an octave away from what came just before
        vals = foldOctaveSlips(vals)
      }
      // cleaned for drawing: flicks dropped, a calm glide, the fading tail of a finished
      // phrase trimmed (only looks back: what's drawn stays put)
      const ended = r[r.length - 1].t < frames[frames.length - 1].t - 0.15
      const sm = cleanVoice(vals, v.lineDetail, ended, 94, r.map((f) => f.level))
      // no dots or stubs: a piece shorter than ~60 ms between gaps isn't drawn
      for (let a = 0; a < sm.length; ) {
        if (sm[a] === null) { a++; continue }
        let b = a
        while (b < sm.length && sm[b] !== null) b++
        if (b - a < 6) for (let k = a; k < b; k++) sm[k] = null
        a = b
      }
      // each filtered point belongs a few readings earlier (the filter only looks back)
      const lag = v.lineDetail === 'smooth' ? 4 : v.lineDetail === 'natural' ? 2 : 0
      const at = (k: number) => r[Math.max(0, k - lag)].t
      ctx.beginPath()
      let px0 = 0, py0 = 0, pen = false, drawn = false
      for (let k = 0; k < sm.length; k++) {
        const m = sm[k]
        if (m === null) {
          if (pen) ctx.lineTo(px0, py0)
          pen = false
          continue
        }
        const x = X(at(k)), yy = Y(m)
        if (!pen) ctx.moveTo(x, yy)
        else ctx.quadraticCurveTo(px0, py0, (px0 + x) / 2, (py0 + yy) / 2)
        px0 = x
        py0 = yy
        pen = drawn = true
      }
      if (!drawn) continue
      if (pen) ctx.lineTo(px0, py0)
      if (discoLive.on && style === 'main') this.neon(() => ctx.stroke(), p.voice, 12)
      else ctx.stroke()
      last = { t: r[r.length - 1].t, y: py0 }
    }
    return last
  }

  /** Separate lane: reference vocal loudness (filled) vs. the singer's level (line), both relative. */
  private drawLoudness(v: GraphView, X: (t: number) => number, t0: number, t1: number, top: number, laneH: number) {
    const { ctx, p, w } = this
    const LO = -15, HI = 12
    const Y = (db: number) => top + laneH - ((clampN(db, LO, HI) - LO) / (HI - LO)) * laneH
    ctx.fillStyle = withAlpha(p.subAlt, discoLive.on ? 0.35 : 0.9) // see-through when the lights are on
    ctx.fillRect(0, top, w, laneH)
    ctx.strokeStyle = withAlpha(p.sub, 0.18)
    ctx.beginPath()
    ctx.moveTo(0, Math.round(Y(0)) + 0.5)
    ctx.lineTo(w, Math.round(Y(0)) + 0.5)
    ctx.stroke()

    // Reference: dense envelope if analysed, else per-note steps.
    ctx.fillStyle = withAlpha(p.sub, 0.45)
    if (v.refLoudness) {
      const e = v.refLoudness
      const i0 = Math.max(0, Math.floor((t0 - e.t0) / e.hop))
      const i1 = Math.min(e.db.length, Math.ceil((t1 - e.t0) / e.hop))
      for (let i = i0; i < i1; i++) {
        const d = e.db[i]
        if (d === null) continue
        const x = X(e.t0 + i * e.hop)
        ctx.fillRect(x, Y(d), Math.max(1, e.hop * v.pxPerSec), top + laneH - Y(d))
      }
    } else {
      for (const n of v.notes) {
        if (n.loudness === undefined || n.endTime < t0 || n.startTime > t1) continue
        const y = Y(n.loudness - v.refLoudMedian)
        ctx.fillRect(X(n.startTime), y, (n.endTime - n.startTime) * v.pxPerSec, top + laneH - y)
      }
    }

    // Singer, relative to their own median (raw mic gain never shown).
    if (v.levelBase !== null) {
      ctx.strokeStyle = withAlpha(p.text, 0.85)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      let pen = false
      let lastT = -Infinity
      for (let i = lowerBoundT(v.frames, t0); i < v.frames.length; i++) {
        const f = v.frames[i]
        if (f.t > t1) break
        if (f.midi === null || f.level === undefined || f.t - lastT > 0.08) pen = false
        if (f.midi === null || f.level === undefined) continue
        const x = X(f.t), y = Y(f.level - v.levelBase)
        if (pen) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
        pen = true
        lastT = f.t
      }
      ctx.stroke()
    }

  }
}

function lowerBoundT(frames: UserFrame[], t: number): number {
  let lo = 0, hi = frames.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid].t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

function clampN(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Display smoothing for pitch lines (scoring always uses raw data).
 * smooth: median 5 → moving average 9 (≈ ±45 ms) — calm and easy to follow.
 * natural: median 3 → average 3 — keeps vibrato and slides.
 * detailed: no smoothing at all.
 */
function smooth(v: number[], detail: LineDetail): number[] {
  if (detail === 'detailed') return v
  const n = v.length
  const mh = detail === 'smooth' ? 2 : 1
  const ah = detail === 'smooth' ? 4 : 1
  const med = v.map((_, i) => {
    const w = v.slice(Math.max(0, i - mh), Math.min(n, i + mh + 1)).sort((a, b) => a - b)
    return w[w.length >> 1]
  })
  return med.map((_, i) => {
    const a = Math.max(0, i - ah), b = Math.min(n, i + ah + 1)
    let s = 0
    for (let k = a; k < b; k++) s += med[k]
    return s / (b - a)
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement)
  const v = (n: string, d: string) => s.getPropertyValue(n).trim() || d
  return {
    bg: v('--bg', '#323437'),
    main: v('--main', '#e2b714'),
    main2: v('--main-2', v('--main', '#e2b714')),
    voice: v('--voice', '#7ccbc2'),
    sub: v('--sub', '#646669'),
    subAlt: v('--sub-alt', '#2c2e31'),
    text: v('--text', '#d1d0c5'),
    error: v('--error', '#ca4754'),
    sharp: v('--sharp', '#e8875b'),
    flat: v('--flat', '#6aa4d9'),
  }
}

const alphaCache = new Map<string, string>()
function withAlpha(hex: string, a: number): string {
  const key = hex + a
  let c = alphaCache.get(key)
  if (!c) {
    const h = hex.replace('#', '')
    const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
    const n = parseInt(full.slice(0, 6), 16)
    c = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
    alphaCache.set(key, c)
  }
  return c
}

/** 1 in the middle, easing to 0 over the outer 12 % at either end (grid lines fade out at the edges). */
function edgeFade(x: number, size: number): number {
  const e = Math.min(x, size - x) / (size * 0.12)
  if (e >= 1) return 1
  if (e <= 0) return 0
  return e * e * (3 - 2 * e)
}

/** Blend two hex colours (k = 0 → a, 1 → b). */
function mix(a: string, b: string, k: number): string {
  const rgb = (h: string) => {
    const x = h.replace('#', '')
    const f = x.length === 3 ? x.split('').map((c) => c + c).join('') : x
    const n = parseInt(f.slice(0, 6), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  return `rgb(${Math.round(r1 + (r2 - r1) * k)},${Math.round(g1 + (g2 - g1) * k)},${Math.round(b1 + (b2 - b1) * k)})`
}
