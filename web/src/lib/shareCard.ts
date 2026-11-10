// "Can you beat me?": after a take, a picture of the score to share (WhatsApp, Instagram,
// …) with a link that opens the same song, and the score to beat.

import { WAVE_PATH } from '../components/Brand'
import type { ReferenceNote, UserFrame } from './types'

export const SITE = 'https://lemodysounds.online'

export interface ShareInfo {
  title: string
  artist?: string | null
  /** overall score, 0..1 */
  score: number
  /** a few of the separate scores, 0..1 */
  parts: [string, number][]
  /** the stretch that was sung: the original melody and the singer's voice */
  notes: ReferenceNote[]
  frames: UserFrame[]
  from: number
  to: number
  /** the song's id in Lemody, when others can open it */
  songId: string | null
}

/** the main score: two decimals */
export const pct = (v: number) => `${(v * 100).toFixed(2)}%`
/** the separate scores: whole percents */
const whole = (v: number) => `${Math.round(v * 100)}%`

/** The link that opens this song for a friend, with the score to beat. */
export function challengeLink(songId: string | null, score: number): string {
  if (!songId) return SITE
  return `${SITE}/?${new URLSearchParams({ song: songId, beat: (score * 100).toFixed(2) })}`
}

export function shareText(i: ShareInfo): string {
  return `I got ${pct(i.score)} singing ${i.title} on Lemody 🎤 Can you beat me?`
}

const W = 1080
const H = 1350

/** The card as a PNG (portrait, the shape stories and chats show best). */
export async function drawCard(i: ShareInfo): Promise<Blob> {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const c = { bg: v('--bg', '#131313'), alt: v('--sub-alt', '#1c1c1d'), text: v('--text', '#ededea'), sub: v('--sub', '#7d7d82'), main: v('--main', '#d8b36f'), voice: v('--voice', '#7ccbc2') }
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
  await document.fonts?.ready

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')!
  const f = (size: number, weight = 500) => `${weight} ${size}px ${font}`

  // background with a soft glow behind the score
  g.fillStyle = c.bg
  g.fillRect(0, 0, W, H)
  const glow = g.createRadialGradient(W / 2, 470, 40, W / 2, 470, 620)
  glow.addColorStop(0, hexAlpha(c.main, 0.16))
  glow.addColorStop(1, hexAlpha(c.main, 0))
  g.fillStyle = glow
  g.fillRect(0, 0, W, H)

  // brand
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  // the wordmark as the site header draws it (Wordmark, size "lg": 30px text), scaled to 44px
  const k = 44 / 30
  drawWave(g, 84, 132, 44 * k, c.main)
  g.fillStyle = c.text
  g.font = f(44, 600)
  g.textBaseline = 'middle'
  g.fillText('lemody', 84 + 44 * k + 8 * k, 132)
  g.textBaseline = 'alphabetic'

  // the song
  g.textAlign = 'center'
  g.fillStyle = c.text
  g.font = f(60, 600)
  g.fillText(fit(g, i.title, W - 160), W / 2, 290)
  if (i.artist) {
    g.fillStyle = c.sub
    g.font = f(38, 400)
    g.fillText(fit(g, i.artist, W - 200), W / 2, 346)
  }

  // the score
  g.fillStyle = c.main
  g.font = f(196, 700)
  g.fillText(pct(i.score), W / 2, 580)
  g.fillStyle = c.sub
  g.font = f(34, 400)
  g.fillText('overall score', W / 2, 640)

  // the melody and the singer's voice
  drawLines(g, i, { x: 90, y: 700, w: W - 180, h: 300 }, c)
  g.textAlign = 'left'
  g.font = f(28, 400)
  legend(g, 90, 1050, hexAlpha(c.text, 0.35), 'original', c.sub)
  legend(g, 290, 1050, c.voice, 'me', c.sub)

  // a few separate scores
  const parts = i.parts.slice(0, 3)
  const colW = (W - 180) / Math.max(1, parts.length)
  parts.forEach(([label, val], k) => {
    const x = 90 + colW * k + colW / 2
    g.textAlign = 'center'
    g.fillStyle = c.text
    g.font = f(48, 600)
    g.fillText(whole(val), x, 1150)
    g.fillStyle = c.sub
    g.font = f(28, 400)
    g.fillText(label, x, 1192)
  })

  // the challenge
  g.textAlign = 'center'
  g.fillStyle = c.text
  g.font = f(36, 600)
  g.fillText('Can you beat me?', W / 2, 1272)
  g.fillStyle = c.sub
  g.font = f(28, 400)
  g.fillText('lemodysounds.online', W / 2, 1314)

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('couldn’t make the picture'))), 'image/png'))
}

function drawLines(g: CanvasRenderingContext2D, i: ShareInfo, box: { x: number; y: number; w: number; h: number }, c: { alt: string; text: string; voice: string }) {
  g.fillStyle = hexAlpha(c.alt, 0.9)
  roundRect(g, box.x, box.y, box.w, box.h, 28)
  g.fill()
  const from = i.from
  const to = Math.max(i.to, from + 1)
  const notes = i.notes.filter((n) => n.sung && n.endTime > from && n.startTime < to)
  const voice = i.frames.filter((fr) => fr.midi !== null && fr.t >= from && fr.t <= to) as (UserFrame & { midi: number })[]
  if (!notes.length && !voice.length) return
  // sung an octave up or down is fine: move the voice next to the melody
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
  const shift = notes.length && voice.length ? 12 * Math.round((med(notes.map((n) => n.midiPitch)) - med(voice.map((fr) => fr.midi))) / 12) : 0
  const all = [...notes.map((n) => n.midiPitch), ...voice.map((fr) => fr.midi + shift)]
  const lo = Math.min(...all) - 2
  const hi = Math.max(...all) + 2
  const pad = 36
  const X = (t: number) => box.x + pad + ((t - from) / (to - from)) * (box.w - 2 * pad)
  const Y = (m: number) => box.y + pad + (1 - (m - lo) / Math.max(1, hi - lo)) * (box.h - 2 * pad)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  // the original: one soft bar per note (like on the graph), the voice drawn over it
  g.strokeStyle = hexAlpha(c.text, 0.35)
  g.lineWidth = 14
  for (const n of notes) {
    g.beginPath()
    g.moveTo(X(Math.max(n.startTime, from)), Y(n.midiPitch))
    g.lineTo(X(Math.min(n.endTime, to)), Y(n.midiPitch))
    g.stroke()
  }
  // the voice: a line, broken where there was no singing
  g.strokeStyle = c.voice
  g.lineWidth = 6
  g.beginPath()
  let prev: number | null = null
  const step = Math.max(1, Math.floor(voice.length / 900))
  for (let k = 0; k < voice.length; k += step) {
    const fr = voice[k]
    const x = X(fr.t)
    const y = Y(fr.midi + shift)
    if (prev === null || fr.t - prev > 0.25) g.moveTo(x, y)
    else g.lineTo(x, y)
    prev = fr.t
  }
  g.stroke()
}

function legend(g: CanvasRenderingContext2D, x: number, y: number, color: string, label: string, textColor: string) {
  g.fillStyle = color
  roundRect(g, x, y - 12, 34, 10, 5)
  g.fill()
  g.fillStyle = textColor
  g.fillText(label, x + 48, y)
}

/** Lemody's mark (the same path as the site's logo), `width` wide, centred on y. */
function drawWave(g: CanvasRenderingContext2D, x: number, y: number, width: number, color: string) {
  const s = width / 48 // the logo's viewBox is 48 × 24
  g.save()
  g.translate(x, y - 12 * s)
  g.scale(s, s)
  g.strokeStyle = color
  g.lineWidth = 2.6
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.stroke(new Path2D(WAVE_PATH))
  g.restore()
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** Shorten text with … until it fits. */
function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

/** A theme colour (#rgb / #rrggbb) with transparency. */
function hexAlpha(color: string, a: number): string {
  const m = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return color
  const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1]
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
