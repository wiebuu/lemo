// Makes a vertical (1080×1920) promo reel from a Lemody song: the song's audio, the
// original singer's pitch line moving past a playhead, karaoke lyrics, a hook, the site
// link and an end card. Everything shown is the real song's data — no made-up singer or score.
//
//   node make-reel.mjs --song songs/yt-NJAv_7lHUIU --hook "Can you sing this line?" [--start 30 --end 41] [--out out/x.mp4]
//   node make-reel.mjs --batch reels.json          (several at once; see reels.json)
//
// Song folders come from the VPS song store (reference.json, lyrics.json, backing.m4a, vocals.m4a).

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const W = 1080, H = 1920, FPS = 30
const END_CARD = 2.0 // seconds after the sung part
const SITE = 'lemodysounds.online'

// ---- fonts: Manrope (clean, rounded, reads well small on a phone); Hiragino for Japanese lyrics
const fontDir = join(here, 'node_modules', '@fontsource', 'manrope', 'files')
for (const w of [500, 600, 700, 800]) for (const sub of ['latin', 'latin-ext']) {
  const f = join(fontDir, `manrope-${sub}-${w}-normal.woff2`)
  if (existsSync(f)) GlobalFonts.registerFromPath(f, 'Manrope')
}
const SANS = `${GlobalFonts.has('Manrope') ? 'Manrope, ' : ''}"Helvetica Neue", "Kohinoor Devanagari", "Hiragino Sans", "Apple SD Gothic Neo", sans-serif`

// ---- arguments
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []),
)

function num(v) {
  return v === undefined || v === true ? undefined : Number(v)
}

// the words around the clip; a reel for another country passes its own (see reels-world.json)
const CARD = {
  link: 'link in profile · sing it yourself, free',
  title: 'Sing it yourself',
  sub: 'see your pitch live on the real song',
  langs: 'free · in your browser · Hindi, Punjabi, English & more',
  tap: 'tap the channel name for the link',
}

async function makeReel({ song, hook, start, end, out, detail, line, card }) {
  card = { ...CARD, ...card }
  const dir = song.startsWith('/') ? song : join(here, song)
  const ref = JSON.parse(readFileSync(join(dir, 'reference.json'), 'utf8'))
  // Hinglish where latin_lyrics.py made it (most people read it faster than Devanagari)
  const lyrFile = ['lyrics.latin.json', 'lyrics.json'].map((f) => join(dir, f)).find(existsSync)
  const lyr = lyrFile ? JSON.parse(readFileSync(lyrFile, 'utf8')) : null
  const lines = (lyr?.timed ?? []).filter((l) => l.text?.trim())
  const readable = (l) => !/[^\u0000-\u024f\u2000-\u206f]/.test(l.text) && !/^\(.*\)$/.test(l.text.trim())
  const c = ref.contour
  const midiAt = (t) => {
    const i = Math.round((t - c.t0) / c.hop)
    return i >= 0 && i < c.midi.length ? c.midi[i] : null
  }

  // ---- which part: the given one, or the lyric line that moves the most (the one worth trying)
  if ((start === undefined || end === undefined) && line) {
    // the line asked for by its words ("kesariya tera"), its first time in the song
    const want = line.toLowerCase()
    const l = lines.find((x) => x.text.toLowerCase().includes(want))
    if (!l) throw new Error(`${basename(dir)}: no lyric line with "${line}"`)
    ;[start, end] = around(l)
  }
  if (start === undefined || end === undefined) {
    let best = null
    for (const l of lines.filter(readable)) {
      const dur = l.end - l.start
      if (dur < 3.5 || dur > 11) continue
      const ms = []
      for (let t = l.start; t < l.end; t += c.hop) {
        const m = midiAt(t)
        if (m !== null) ms.push(m)
      }
      if (ms.length < (dur / c.hop) * 0.45) continue // mostly not sung
      ms.sort((a, b) => a - b)
      const range = ms[Math.floor(ms.length * 0.92)] - ms[Math.floor(ms.length * 0.08)]
      const score = range + (ms.length * c.hop) / dur * 3 + (l.start > 25 ? 1 : 0)
      if (!best || score > best.score) best = { l, score }
    }
    const l = best?.l ?? lines[0]
    if (!l) throw new Error(`${basename(dir)}: no timed lyrics — pass --start and --end`)
    ;[start, end] = around(l)
  }
  // a little before the line, and on into the next ones until it's long enough to try (≥ 8 s)
  function around(l) {
    const s0 = Math.max(0, l.start - 1.4)
    let e0 = l.end + 0.9
    for (let k = lines.indexOf(l) + 1; e0 - s0 < 8 && k < lines.length && lines[k].start < e0 + 1.5; k++) e0 = lines[k].end + 0.9
    return [s0, Math.min(e0, s0 + 16)]
  }
  const sung = end - start
  const total = sung + END_CARD
  const frames = Math.round(total * FPS)
  const title = ref.title ?? basename(dir)
  const artist = ref.artist ?? ''
  hook = hook ?? 'Can you sing this line?'
  out = out ? (out.startsWith('/') ? out : join(here, out)) : join(here, 'out', `${slug(title)}.mp4`)
  mkdirSync(dirname(out), { recursive: true })
  console.log(`${title}: ${start.toFixed(1)}–${end.toFixed(1)} s → ${out}`)

  // ---- the encoder: frames in on stdin, the song's own audio (backing + vocals) mixed in
  const audio = ['backing.m4a', 'vocals.m4a'].filter((f) => existsSync(join(dir, f)))
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    ...audio.flatMap((f) => ['-ss', String(start), '-t', String(total), '-i', join(dir, f)]),
    ...(audio.length
      ? ['-filter_complex',
        `${audio.map((_, i) => `[${i + 1}:a]`).join('')}amix=inputs=${audio.length}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.25,afade=t=out:st=${(total - 1.6).toFixed(2)}:d=1.6[a]`,
        '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k']
      : []),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', '-shortest', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] })
  const done = new Promise((res, rej) => ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))))

  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const view = { center: null }
  const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)))
  for (let f = 0; f < frames; f++) {
    const t = start + f / FPS
    drawFrame(ctx, { t, start, end, total, ref, lines, midiAt, title, artist, hook, view, detail, card })
    await write(Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer))
    if (f === Math.round(Math.min(sung * 0.6, sung - 0.5) * FPS)) writeFileSync(out.replace(/\.mp4$/, '.jpg'), canvas.toBuffer('image/jpeg', 92))
  }
  ff.stdin.end()
  await done
}

// ---- one frame -------------------------------------------------------------------------------

// Layout (v2): a small header (hook + song), a big graph, big lyrics, a small link at the foot.
// The bottom ~330 px and the right edge sit under YouTube's own Shorts buttons and title, so
// nothing important goes there.
const G = { top: 430, bottom: 1150, playhead: 0.4, pxPerSec: 235, span: 13 }
const ACCENT = [150, 180, 255] // the soft blue the sung line glows with
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

const graphLayer = (() => {
  const canvas = createCanvas(W, H)
  return { canvas, ctx: canvas.getContext('2d') }
})()

function drawFrame(ctx, s) {
  const { t, start, end, ref, lines, midiAt, title, artist, hook, view, card } = s
  const gh = G.bottom - G.top, gm = (G.top + G.bottom) / 2

  // ---- background: near-black, a faint coloured light behind the graph
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0c0c10')
  bg.addColorStop(1, '#09090b')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, gm, 30, W / 2, gm, 720)
  glow.addColorStop(0, rgba(ACCENT, 0.075))
  glow.addColorStop(1, rgba(ACCENT, 0))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // ---- header: the hook, and the song under it — nothing else
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `800 58px ${SANS}`
  let hookLines = wrap(ctx, hook, 900)
  let hs = 58
  if (hookLines.length > 2) {
    hs = 50
    ctx.font = `800 ${hs}px ${SANS}`
    hookLines = wrap(ctx, hook, 920)
  }
  // two lines: balance them, so no single word hangs on the second
  if (hookLines.length === 2) {
    let wmax = 900
    while (wmax > 400 && wrap(ctx, hook, wmax - 20).length === 2) wmax -= 20
    hookLines = wrap(ctx, hook, wmax)
  }
  const hy = 268 - (hookLines.length - 1) * (hs + 8)
  ctx.fillStyle = '#ffffff'
  hookLines.forEach((l, i) => ctx.fillText(l, W / 2, hy + i * (hs + 10)))
  ctx.fillStyle = '#7f8090'
  ctx.font = `600 32px ${SANS}`
  ctx.fillText(`${title}${artist ? `  ·  ${artist}` : ''}`, W / 2, hy + (hookLines.length - 1) * (hs + 10) + 62, 900)

  // ---- the graph, following the melody up and down (smoothly)
  const px = W * G.playhead
  const t0 = t - px / G.pxPerSec, t1 = t + (W - px) / G.pxPerSec
  const X = (u) => px + (u - t) * G.pxPerSec
  const near = []
  for (let u = t - 1.5; u < t + 2.5; u += 0.06) {
    const m = midiAt(u)
    if (m !== null) near.push(m)
  }
  if (near.length) {
    near.sort((a, b) => a - b)
    // the middle of the range around now, so the whole phrase fits
    const lo = near[Math.floor(near.length * 0.05)], hi = near[Math.ceil(near.length * 0.95) - 1]
    const target = (lo + hi) / 2
    view.center = view.center === null ? target : view.center + (target - view.center) * 0.09
    // and the note being sung never leaves the graph
    const cur = midiAt(t), room = G.span / 2 - 1.6
    if (cur !== null) view.center = Math.min(Math.max(view.center, cur - room), cur + room)
  }
  const center = view.center ?? 60
  const sp = gh / G.span
  const Y = (m) => gm - (m - center) * sp

  const main = ctx
  ctx = graphLayer.ctx
  ctx.clearRect(0, 0, W, H)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, G.top - 40, W, gh + 80)
  ctx.clip()
  // a few quiet guide lines (every whole tone), the C's a touch brighter
  for (let m = Math.floor(center - G.span / 2) - 1; m <= Math.ceil(center + G.span / 2) + 1; m++) {
    const pc = ((m % 12) + 12) % 12
    if (pc % 2) continue
    const y = Math.round(Y(m)) + 0.5
    ctx.fillStyle = `rgba(255,255,255,${pc === 0 ? 0.075 : 0.035})`
    ctx.fillRect(0, y, W, pc === 0 ? 2 : 1)
  }

  // the original singer's line: smoothed, broken at silences and leaps
  const c = ref.contour
  const path = []
  let run = []
  const flush = () => {
    if (run.length > 3) path.push(smoothRun(run))
    run = []
  }
  const i0 = Math.max(0, Math.floor((t0 - 0.3 - c.t0) / c.hop)), i1 = Math.min(c.midi.length, Math.ceil((t1 + 0.3 - c.t0) / c.hop))
  for (let i = i0; i < i1; i++) {
    const m = c.midi[i]
    const u = c.t0 + i * c.hop
    if (m === null || u < start - 0.2 || u > end + 0.3) {
      flush()
      continue
    }
    const prev = run[run.length - 1]
    if (prev && Math.abs(m - prev.m) > 3) flush()
    run.push({ x: X(u), m })
  }
  flush()
  const trace = () => {
    ctx.beginPath()
    for (const r of path) {
      ctx.moveTo(r[0].x, Y(r[0].m))
      // through the midpoints: a soft curve with no corners
      for (let k = 1; k < r.length - 1; k++) {
        const xm = (r[k].x + r[k + 1].x) / 2, ym = (Y(r[k].m) + Y(r[k + 1].m)) / 2
        ctx.quadraticCurveTo(r[k].x, Y(r[k].m), xm, ym)
      }
      const l = r[r.length - 1]
      ctx.lineTo(l.x, Y(l.m))
    }
  }
  const stroke = (style, width, blur, blurColor) => {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = width
    ctx.strokeStyle = style
    if (blur) {
      ctx.shadowColor = blurColor
      ctx.shadowBlur = blur
    }
    trace()
    ctx.stroke()
    ctx.restore()
  }
  // what's coming: clearly visible but quiet
  ctx.save()
  ctx.beginPath()
  ctx.rect(px, 0, W - px, H)
  ctx.clip()
  stroke('rgba(255,255,255,0.30)', 10, 0)
  ctx.restore()
  // what's been sung: bright, with a coloured glow
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, px, H)
  ctx.clip()
  stroke(rgba(ACCENT, 0.35), 26, 40, rgba(ACCENT, 0.9))
  stroke('#ffffff', 11, 18, 'rgba(255,255,255,0.8)')
  ctx.restore()
  ctx.restore()

  // the edges fade out
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  for (const [x0, x1] of [[0, 190], [W, W - 190]]) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0)
    g.addColorStop(0, 'rgba(0,0,0,1)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(Math.min(x0, x1), G.top - 60, 190, gh + 120)
  }
  ctx.restore()
  main.drawImage(graphLayer.canvas, 0, 0)
  ctx = main

  // playhead + the dot riding the line
  const ph = ctx.createLinearGradient(0, G.top, 0, G.bottom)
  ph.addColorStop(0, 'rgba(255,255,255,0)')
  ph.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  ph.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = ph
  ctx.fillRect(Math.round(px) - 1, G.top, 2, gh)
  const now = t <= end ? midiAt(t) : null
  if (now !== null) {
    const y = Y(now)
    const g = ctx.createRadialGradient(px, y, 0, px, y, 60)
    g.addColorStop(0, rgba(ACCENT, 0.55))
    g.addColorStop(1, rgba(ACCENT, 0))
    ctx.fillStyle = g
    ctx.fillRect(px - 60, y - 60, 120, 120)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(px, y, 15, 0, Math.PI * 2)
    ctx.fill()
  }

  // a thin progress line under the graph
  const p = Math.max(0, Math.min(1, (t - start) / (end - start)))
  ctx.fillStyle = 'rgba(255,255,255,0.10)'
  roundRect(ctx, 290, G.bottom + 34, W - 580, 4, 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  roundRect(ctx, 290, G.bottom + 34, (W - 580) * p, 4, 2)
  ctx.fill()

  // ---- karaoke lyrics, big: the line being sung word by word, the next one small
  const li = lines.findIndex((l) => t >= l.start - 0.25 && t < l.end + 0.15)
  const cur = li >= 0 ? lines[li] : lines.find((l) => l.start > t && l.start < end + 0.5)
  const LY = 1310
  if (cur && cur.start < end + 0.2) {
    ctx.textAlign = 'left'
    const spaced = /\s/.test(cur.text.trim()) || !/[぀-ヿ一-鿿]/.test(cur.text)
    const parts = spaced ? cur.text.split(/\s+/) : [...cur.text]
    const words = cur.words?.length ? cur.words : parts.map((text, i, all) => ({
      start: cur.start + ((cur.end - cur.start) * i) / all.length, end: cur.start + ((cur.end - cur.start) * (i + 1)) / all.length, text: spaced ? `${text} ` : text,
    }))
    let size = 78
    ctx.font = `800 ${size}px ${SANS}`
    const tw = ctx.measureText(cur.text).width
    if (tw > 920) size = tw > 1700 ? 62 : 70 // long: smaller, two rows at most
    ctx.font = `800 ${size}px ${SANS}`
    const rows = []
    let row = [], width = 0
    for (const w of words) {
      const ww = ctx.measureText(w.text.endsWith(' ') || !spaced ? w.text : `${w.text} `).width
      if (row.length && width + ww > 920) {
        rows.push({ row, width })
        row = []
        width = 0
      }
      row.push({ ...w, ww })
      width += ww
    }
    if (row.length) rows.push({ row, width })
    // fade a new line in
    const fade = Math.min(1, Math.max(0, (t - (cur.start - 0.25)) / 0.18))
    ctx.globalAlpha = 0.35 + 0.65 * fade
    rows.forEach(({ row, width }, r) => {
      let x = (W - width) / 2
      const y = LY + r * (size + 14)
      for (const w of row) {
        const k = Math.max(0, Math.min(1, (t - w.start) / 0.12)) // each word lights up quickly, not in a blink
        if (k > 0) {
          ctx.save()
          ctx.shadowColor = rgba(ACCENT, 0.7 * k)
          ctx.shadowBlur = 26
          ctx.fillStyle = `rgba(255,255,255,${0.32 + 0.68 * k})`
          ctx.fillText(w.text, x, y)
          ctx.restore()
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.32)'
          ctx.fillText(w.text, x, y)
        }
        x += w.ww
      }
    })
    ctx.globalAlpha = 1
    const next = lines[lines.indexOf(cur) + 1]
    if (next && next.start < end + 0.2) {
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(255,255,255,0.26)'
      ctx.font = `700 40px ${SANS}`
      ctx.fillText(fit(ctx, next.text, 900), W / 2, LY + (rows.length - 1) * (size + 14) + 72)
    }
  }

  // ---- the link: one small pill with the logo
  ctx.font = `700 30px ${SANS}`
  const sw = ctx.measureText(SITE).width
  const pw = sw + 44 + 32 + 14
  const pyy = 1560
  roundRect(ctx, (W - pw) / 2, pyy, pw, 62, 31)
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  drawWave(ctx, (W - pw) / 2 + 22, pyy + 31, 32)
  ctx.textAlign = 'left'
  ctx.fillStyle = '#e8e8ee'
  ctx.fillText(SITE, (W - pw) / 2 + 22 + 32 + 14, pyy + 42)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#6c6d78'
  ctx.font = `600 26px ${SANS}`
  ctx.fillText(card.link, W / 2, pyy + 104, 900)

  // ---- end card (short: it's the loop back to the start that counts on Shorts)
  const e = (t - end) / 0.35
  if (e > 0) {
    const a = Math.min(1, e)
    ctx.fillStyle = `rgba(10,10,12,${a})`
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = a
    drawLogo(ctx, W / 2, 660, 1.8)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffffff'
    ctx.font = `800 76px ${SANS}`
    ctx.fillText(card.title, W / 2, 850, 960)
    ctx.fillStyle = '#9a9aa6'
    ctx.font = `600 38px ${SANS}`
    ctx.fillText(card.sub, W / 2, 920, 960)
    ctx.font = `800 54px ${SANS}`
    const bw = ctx.measureText(SITE).width + 100
    roundRect(ctx, (W - bw) / 2, 1000, bw, 108, 54)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.fillStyle = '#0b0b0d'
    ctx.fillText(SITE, W / 2, 1073)
    ctx.fillStyle = '#74747f'
    ctx.font = `600 32px ${SANS}`
    ctx.fillText(card.langs, W / 2, 1180, 960)
    ctx.fillStyle = '#d8d8e0'
    ctx.font = `700 38px ${SANS}`
    ctx.fillText(card.tap, W / 2, 1290, 960)
    ctx.globalAlpha = 1
  }
}

function drawWave(ctx, x, cy, w) {
  ctx.save()
  ctx.translate(x, cy)
  const s = w / 48
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(2 * s, 2 * s)
  ctx.bezierCurveTo(7 * s, 2 * s, 8 * s, -7 * s, 13 * s, -7 * s)
  ctx.bezierCurveTo(18 * s, -7 * s, 20 * s, 7 * s, 26 * s, 7 * s)
  ctx.bezierCurveTo(32 * s, 7 * s, 33 * s, -4 * s, 38 * s, -4 * s)
  ctx.bezierCurveTo(43 * s, -4 * s, 44 * s, 1 * s, 46 * s, 1 * s)
  ctx.stroke()
  ctx.restore()
}


// a few frames' moving average: the line stays alive (vibrato shows) without the tracker's jitter
function smoothRun(run) {
  const k = 3
  return run.map((p, i) => {
    let s = 0, n = 0
    for (let j = Math.max(0, i - k); j <= Math.min(run.length - 1, i + k); j++) {
      s += run[j].m
      n++
    }
    return { x: p.x, m: s / n }
  })
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
  // the logo's wave (same path as the site's, scaled to 64×32)
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

function wrap(ctx, text, max) {
  const out = []
  let line = ''
  for (const w of text.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > max && line) {
      out.push(line)
      line = w
    } else line = next
  }
  if (line) out.push(line)
  return out
}

/** cut a line that doesn't fit, with "…" */
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text
  const words = text.split(/\s+/)
  while (words.length > 1 && ctx.measureText(`${words.join(' ')}…`).width > max) words.pop()
  return `${words.join(' ')}…`
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function slug(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'reel'
}

// ---- run (after everything above is defined)
if (args.batch) {
  const list = JSON.parse(readFileSync(args.batch, 'utf8'))
  for (const r of list) await makeReel(r)
} else {
  if (!args.song) {
    console.error('usage: node make-reel.mjs --song songs/yt-… --hook "…" [--start s --end s] [--out file.mp4]')
    process.exit(1)
  }
  await makeReel({ song: args.song, hook: args.hook, line: args.line, start: num(args.start), end: num(args.end), out: args.out })
}
