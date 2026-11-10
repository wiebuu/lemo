// Turns a phone clip of someone singing on Lemody into a vertical (1080×1920) reel: the clip
// itself (filled to 9:16, a blurred copy behind it when it's wider), a light grade, the song
// name on top, the site link at the bottom and the end card.
//
//   node make-clip.mjs --in ~/Downloads/IMG_8378.mov --title "Aaoge Tum Kabhi" --artist "The Local Train" --out out/16-aaoge-tum-kabhi-live.mp4

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const W = 1080, H = 1920, FPS = 30
const END_CARD = 2.8
const SITE = 'lemodysounds.online'

const geist = join(here, '..', 'web', 'node_modules', '@fontsource', 'geist-sans', 'files')
for (const w of [400, 600, 700]) {
  const f = join(geist, `geist-sans-latin-${w}-normal.woff2`)
  if (existsSync(f)) GlobalFonts.registerFromPath(f, 'Geist')
}
const SANS = `${GlobalFonts.has('Geist') ? 'Geist, ' : ''}"Helvetica Neue", sans-serif`

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []),
)

function overlay({ title, artist, line }) {
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  // soft dark bands so the words read over any frame
  let g = ctx.createLinearGradient(0, 0, 0, 560)
  g.addColorStop(0, 'rgba(0,0,0,0.78)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, 560)
  g = ctx.createLinearGradient(0, H - 520, 0, H)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,0.8)')
  ctx.fillStyle = g
  ctx.fillRect(0, H - 520, W, 520)

  drawLogo(ctx, W / 2, 150, 1.15)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 76px ${SANS}`
  ctx.fillText(title, W / 2, 290, 980)
  ctx.fillStyle = '#b5b5b5'
  ctx.font = `500 40px ${SANS}`
  ctx.fillText(line, W / 2, 352, 980)
  if (artist) {
    ctx.fillStyle = '#8a8a8a'
    ctx.font = `500 34px ${SANS}`
    ctx.fillText(artist, W / 2, 404, 980)
  }

  ctx.font = `700 50px ${SANS}`
  const bw = ctx.measureText(SITE).width + 90
  roundRect(ctx, (W - bw) / 2, H - 300, bw, 100, 50)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.fillStyle = '#0d0d0d'
  ctx.fillText(SITE, W / 2, H - 232)
  ctx.fillStyle = '#d0d0d0'
  ctx.font = `500 36px ${SANS}`
  ctx.fillText('sing any song · see your voice live · free', W / 2, H - 140, 980)
  return cv.toBuffer('image/png')
}

function endCard() {
  const cv = createCanvas(W, H)
  const ctx = cv.getContext('2d')
  ctx.fillStyle = 'rgba(13,13,13,0.9)'
  ctx.fillRect(0, 0, W, H)
  drawLogo(ctx, W / 2, 640, 2.2)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 84px ${SANS}`
  ctx.fillText('Sing it yourself', W / 2, 860)
  ctx.fillStyle = '#a5a5a5'
  ctx.font = `500 44px ${SANS}`
  ctx.fillText('see your pitch live on the real song', W / 2, 940)
  ctx.font = `700 64px ${SANS}`
  const bw = ctx.measureText(SITE).width + 110
  roundRect(ctx, (W - bw) / 2, 1030, bw, 120, 60)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.fillStyle = '#0d0d0d'
  ctx.fillText(SITE, W / 2, 1113)
  ctx.fillStyle = '#7d7d7d'
  ctx.font = `500 38px ${SANS}`
  ctx.fillText('free · in your browser · Hindi, Punjabi, English & more', W / 2, 1230, 980)
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 46px ${SANS}`
  ctx.fillText('link in profile', W / 2, 1370, 980)
  return cv.toBuffer('image/png')
}

function drawLogo(ctx, cx, cy, scale = 1) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.font = `600 34px ${SANS}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const tw = ctx.measureText('lemody').width
  const total = 64 + 14 + tw
  ctx.translate(-total / 2, 0)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3.4
  ctx.lineCap = 'round'
  ctx.beginPath()
  const s = 64 / 48
  ctx.moveTo(2 * s, (14 - 12) * s)
  ctx.bezierCurveTo(7 * s, 2 * s, 8 * s, -7 * s, 13 * s, -7 * s)
  ctx.bezierCurveTo(18 * s, -7 * s, 20 * s, 7 * s, 26 * s, 7 * s)
  ctx.bezierCurveTo(32 * s, 7 * s, 33 * s, -4 * s, 38 * s, -4 * s)
  ctx.bezierCurveTo(43 * s, -4 * s, 44 * s, 1 * s, 46 * s, 1 * s)
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.fillText('lemody', 64 + 14, 1)
  ctx.restore()
  ctx.textBaseline = 'alphabetic'
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function duration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  return Number(r.stdout.trim())
}

const input = args.in.replace(/^~/, process.env.HOME)
const out = join(here, args.out)
mkdirSync(dirname(out), { recursive: true })
const tmp = join(here, 'data')
mkdirSync(tmp, { recursive: true })
const ov = join(tmp, 'clip-overlay.png'), ec = join(tmp, 'clip-end.png')
writeFileSync(ov, overlay({ title: args.title, artist: args.artist, line: args.line ?? 'sung live on Lemody · the line is the voice' }))
writeFileSync(ec, endCard())

const d = duration(input)
const total = d + END_CARD
const vf = [
  // the clip filled to 9:16 over a blurred, darker copy of itself
  `[0:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=40,eq=brightness=-0.12[bg]`,
  `[0:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,eq=brightness=0.04:contrast=1.06:saturation=1.12,unsharp=5:5:0.6[fg]`,
  `[bg][fg]overlay=(W-w)/2:(H-h)/2,tpad=stop_mode=clone:stop_duration=${END_CARD}[v0]`,
  `[1:v]format=rgba,fade=in:st=0:d=0.5:alpha=1[ov]`,
  `[v0][ov]overlay=0:0:enable='lt(t,${d})'[v1]`,
  `[2:v]format=rgba,fade=in:st=${d}:d=0.45:alpha=1[ec]`,
  `[v1][ec]overlay=0:0:enable='gte(t,${d})',format=yuv420p[v]`,
  `[0:a]loudnorm=I=-14:TP=-1.5,apad=whole_dur=${total},afade=out:st=${d - 0.4}:d=0.9[a]`,
].join(';')
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-loop', '1', '-t', String(total), '-i', ov, '-loop', '1', '-t', String(total), '-i', ec,
  '-filter_complex', vf, '-map', '[v]', '-map', '[a]', '-t', String(total), '-r', String(FPS),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', out], { stdio: 'inherit' })
if (r.status !== 0) process.exit(r.status ?? 1)
spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.min(2, d / 2)), '-i', out, '-frames:v', '1', out.replace(/\.mp4$/, '.jpg')])
console.log(`${out} · ${total.toFixed(1)} s`)
