import { useEffect, useRef } from 'react'
import { easeHue, hueForNote, MusicSense } from '../lib/disco'
import { discoLive } from '../lib/discoState'
import { studio } from '../state/studio'

/**
 * Disco lights — a small light show around the edges, driven by the music itself:
 *
 *   aurora      slow light drifting round all four edges, in the singer's melody colour,
 *               breathing with the song's energy
 *   kick        the floor lights up and a shockwave rolls out from the bottom
 *   snare       stage beams from the top corners flash and sweep, sides taking turns
 *   hi-hats     small sparkles along the edges
 *   build-up    beams lean in and sweep faster as the energy climbs
 *   drop        the frame flashes, the colours swing, beams come up from the floor
 *               too and light bursts in from the edges
 *
 * The middle of the screen stays clear (graph, lyrics). Drawn on a half-size canvas
 * with additive light, no React re-render per frame.
 */

interface Ring { age: number; power: number; hue: number }
interface Spark { x: number; y: number; age: number; life: number; size: number; hue: number }
interface Particle { x: number; y: number; vx: number; vy: number; age: number; life: number; hue: number }

const SCALE = 0.5 // canvas pixels per CSS pixel: soft light needs no detail

export function Disco() {
  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = cv.current!
    const ctx = canvas.getContext('2d')!
    const sense = new MusicSense()
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    let W = 0, H = 0
    const resize = () => {
      W = canvas.width = Math.max(1, Math.round(innerWidth * SCALE))
      H = canvas.height = Math.max(1, Math.round(innerHeight * SCALE))
    }
    resize()
    addEventListener('resize', resize)

    let hue = 280 // follows the melody
    let shift = 0 // palette swing after a drop
    let shiftTarget = 0
    let glow = 0 // lights up while the song plays
    let t = 0
    let last = performance.now()
    const rings: Ring[] = []
    const sparks: Spark[] = []
    const parts: Particle[] = []
    let raf = 0
    let lastBeat: number | null = null

    const rad = (x: number, y: number, r: number, h: number, a: number, sat = 90, light = 58) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `hsla(${h},${sat}%,${light}%,${a})`)
      g.addColorStop(0.45, `hsla(${h},${sat}%,${light - 6}%,${a * 0.45})`)
      g.addColorStop(1, `hsla(${h},${sat}%,${light - 12}%,0)`)
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }

    /** A stage beam from (sx, sy) at `angle`, fading along its length. */
    const beam = (sx: number, sy: number, angle: number, len: number, spread: number, h: number, a: number) => {
      if (a < 0.01) return
      for (const [k, w] of [[1, 1], [0.45, 2.2]] as const) { // bright core + soft halo: depth
        const sp = spread * w
        const x1 = sx + Math.cos(angle - sp) * len, y1 = sy + Math.sin(angle - sp) * len
        const x2 = sx + Math.cos(angle + sp) * len, y2 = sy + Math.sin(angle + sp) * len
        const g = ctx.createLinearGradient(sx, sy, sx + Math.cos(angle) * len, sy + Math.sin(angle) * len)
        g.addColorStop(0, `hsla(${h},95%,72%,${a * k})`)
        g.addColorStop(0.55, `hsla(${h},90%,60%,${a * k * 0.35})`)
        g.addColorStop(1, `hsla(${h},90%,55%,0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.closePath()
        ctx.fill()
      }
    }

    /** a point near one of the edges (sparkles, drop light) */
    const edgePoint = (): [number, number] => {
      const side = Math.floor(Math.random() * 4)
      const along = Math.random()
      const depth = Math.random() * 0.12
      return side === 0 ? [along * W, depth * H] : side === 1 ? [W - depth * W, along * H] : side === 2 ? [along * W, H - depth * H] : [depth * W, along * H]
    }

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      t += dt
      const f = studio.discoFrame()
      const s = sense.update(f.bands, dt)
      if (f.midi !== null) hue = easeHue(hue, hueForNote(f.midi), dt * 2.5)
      glow += ((f.playing ? 1 : 0) - glow) * Math.min(1, dt * 2)

      if (s.dropHit) {
        shiftTarget = (shiftTarget + 150) % 360
        if (!calm) for (let i = 0; i < 70; i++) {
          const [x, y] = edgePoint()
          const ang = Math.atan2(H / 2 - y, W / 2 - x) + (Math.random() - 0.5) * 1.2
          const v = (0.15 + Math.random() * 0.35) * Math.min(W, H)
          parts.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, age: 0, life: 1 + Math.random() * 0.8, hue: hue + shiftTarget + Math.random() * 60 })
        }
      }
      shift = easeHue(shift, shiftTarget, dt * 1.2)
      if (s.drop < 0.05 && shiftTarget !== 0) shiftTarget = easeHue(shiftTarget, 0, dt * 0.08) // drift home after the drop
      const H0 = (hue + shift) % 360

      // the disco button pulses on the song's beat (its analysed beat grid; the live
      // kick when there's no grid), a little bigger on the first beat of each bar
      const gridBeat = f.beatIndex !== null && f.beatIndex !== lastBeat && f.playing
      if (f.beatIndex !== null) lastBeat = f.beatIndex
      if (!calm && (gridBeat || (f.beatIndex === null && s.kickHit))) {
        const to = (f.barStart ? 1.2 : 1.11) + 0.06 * s.main
        document.querySelector('[data-dj-icon]')?.animate(
          [{ transform: 'scale(1)' }, { transform: `scale(${to})`, offset: 0.25 }, { transform: 'scale(1)' }],
          { duration: 280, easing: 'ease-out' },
        )
      }
      // each light only for its own sound: no kick → no shockwave, no hi-hats → no sparkles
      if (!calm && s.kickHit && s.kick > 0.6 && s.presence.sub > 0.45) rings.push({ age: 0, power: s.kick * (0.12 + 0.88 * s.main ** 2), hue: H0 + 20 })
      if (!calm && s.hatHit && s.presence.high > 0.35) for (let i = 0; i < 1 + Math.round(s.main * 5); i++) {
        const [x, y] = edgePoint()
        sparks.push({ x, y, age: 0, life: 0.25 + Math.random() * 0.3, size: (2 + Math.random() * 4) * (W / 700), hue: H0 + 60 + Math.random() * 80 })
      }
      if (sparks.length > 90) sparks.splice(0, sparks.length - 90)

      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, W, H)
      if (glow < 0.01 && !parts.length) {
        raf = requestAnimationFrame(frame)
        return
      }
      ctx.globalCompositeOperation = 'lighter'
      const E = s.energy
      const D = s.drop
      const M = s.main // the song's big lines: the full show
      const big = Math.max(W, H)
      const pr = s.presence
      const on = (x: number) => Math.max(0, Math.min(1, (x - 0.3) / 0.4)) // this sound is clearly playing
      const amp = 0.3 + 0.7 * M // quiet parts stay subtle, the big lines go all the way

      // aurora: slow light drifting round the edges
      const breathe = 0.05 + 0.07 * E + 0.34 * M + 0.18 * D
      const drift = (k: number) => Math.sin(t * (0.11 + k * 0.03) + k * 1.7)
      rad(-W * 0.12, H * (0.45 + 0.25 * drift(0)), big * 0.6, H0, breathe * glow)
      rad(W * 1.12, H * (0.55 + 0.25 * drift(1)), big * 0.6, H0 + 50, breathe * glow)
      rad(W * (0.5 + 0.3 * drift(2)), -H * 0.18, big * 0.5, H0 - 40, breathe * 0.8 * glow)
      rad(W * (0.5 + 0.3 * drift(3)), H * 1.18, big * 0.55, H0 + 20, (breathe + 0.3 * s.kick * on(pr.bass) * amp) * glow)
      // the singer: a soft light from above in the melody's colour, as loud as they sing
      if (pr.vocal > 0.02) rad(W * (0.5 + 0.12 * drift(4)), -H * 0.08, big * (0.32 + 0.12 * M), H0 + 15, pr.vocal * (0.08 + 0.3 * M) * glow, 95, 66)

      if (!calm) {
        // kick: the floor lights up
        const floor = ctx.createLinearGradient(0, H, 0, H * 0.62)
        floor.addColorStop(0, `hsla(${H0 + 20},95%,60%,${(0.6 * s.kick * on(pr.sub) * amp + 0.12 * M) * glow})`)
        floor.addColorStop(1, `hsla(${H0 + 20},95%,60%,0)`)
        ctx.fillStyle = floor
        ctx.fillRect(0, H * 0.62, W, H * 0.38)

        // shockwaves rolling out from the floor
        for (const r of rings) {
          r.age += dt
          const p = r.age / 0.9
          if (p >= 1) continue
          ctx.save()
          ctx.beginPath()
          ctx.ellipse(W / 2, H * 1.04, p * W * 0.8, p * H * 0.24, 0, Math.PI, 0) // stays on the floor, under the lyrics
          ctx.strokeStyle = `hsla(${r.hue},95%,66%,${0.42 * r.power * (1 - p) * glow})`
          ctx.lineWidth = (10 + 18 * (1 - p)) * (W / 700)
          ctx.shadowColor = `hsla(${r.hue},95%,60%,0.8)`
          ctx.shadowBlur = 24 * (W / 700)
          ctx.stroke()
          ctx.restore()
        }
        for (let i = rings.length - 1; i >= 0; i--) if (rings[i].age > 0.9) rings.splice(i, 1)

        // stage beams from the top corners (and the floor, during a drop)
        const speed = 0.35 + E * 0.6 + s.build * 0.8 + D * 1.4
        const lean = s.build * 0.25 // lean in as the energy climbs
        const sides = s.beat % 2
        const beams: [number, number, number, number][] = [
          // source x, source y, base angle, which side
          [-W * 0.04, -H * 0.06, Math.PI * 0.25 + lean, 0],
          [W * 1.04, -H * 0.06, Math.PI * 0.75 - lean, 1],
        ]
        if (M > 0.35) beams.push( // the big lines bring in more lights
          [-W * 0.04, -H * 0.06, Math.PI * 0.12 + lean, 0], [W * 1.04, -H * 0.06, Math.PI * 0.88 - lean, 1],
        )
        if (D > 0.15) beams.push(
          [W * 0.02, H * 1.06, -Math.PI * 0.3, 0], [W * 0.98, H * 1.06, -Math.PI * 0.7, 1],
          [W * 0.3, H * 1.06, -Math.PI * 0.42, 1], [W * 0.7, H * 1.06, -Math.PI * 0.58, 0],
        )
        beams.forEach(([sx, sy, base, side], i) => {
          const sweep = Math.sin(t * speed + i * 1.3) * (0.22 + D * 0.25)
          const hit = s.snare * on(pr.mid) * (side === sides ? 1 : 0.45)
          const extra = i >= 2 && i < 4 ? Math.min(1, (M - 0.35) / 0.3) : 1 // big-line beams fade in
          // on the big lines the beams stay up the whole line, and every snare pushes them brighter
          const a = (0.02 + 0.05 * E * amp + 0.16 * M + 0.5 * hit * amp + 0.3 * D) * glow * extra
          beam(sx, sy, base + sweep, big * (0.75 + 0.2 * E), 0.045 + 0.02 * D, H0 + (i % 2 ? 35 : -10), a)
        })

        // hi-hat sparkles
        for (const p of sparks) {
          p.age += dt
          const k = 1 - p.age / p.life
          if (k > 0) rad(p.x, p.y, p.size * (1.5 + k), p.hue, 0.8 * k * glow, 95, 75)
        }
        for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].age > sparks[i].life) sparks.splice(i, 1)

        // the drop: the frame flashes and light bursts in from the edges
        if (D > 0.02) {
          for (const [x0, y0, x1, y1] of [[0, 0, W * 0.28, 0], [W, 0, W * 0.72, 0], [0, 0, 0, H * 0.3], [0, H, 0, H * 0.7]] as const) {
            const g = ctx.createLinearGradient(x0, y0, x1, y1)
            g.addColorStop(0, `hsla(${H0 + 30},95%,65%,${0.5 * D * D * glow})`)
            g.addColorStop(1, `hsla(${H0 + 30},95%,65%,0)`)
            ctx.fillStyle = g
            ctx.fillRect(0, 0, W, H)
          }
        }
      }
      for (const p of parts) {
        p.age += dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vx *= 1 - dt * 0.9
        p.vy *= 1 - dt * 0.9
        const k = 1 - p.age / p.life
        if (k > 0) rad(p.x, p.y, (3 + 5 * k) * (W / 700), p.hue, 0.7 * k * glow, 95, 72)
      }
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].age > parts[i].life) parts.splice(i, 1)

      discoLive.hue = H0
      discoLive.main = Math.max(M, D)
      raf = requestAnimationFrame(frame)
    }
    discoLive.on = true
    raf = requestAnimationFrame(frame)
    return () => {
      discoLive.on = false
      discoLive.main = 0
      cancelAnimationFrame(raf)
      removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={cv} className="disco" aria-hidden />
}
