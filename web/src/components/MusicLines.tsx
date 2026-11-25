import { useEffect, useRef } from 'react'
import { studio } from '../state/studio'

/**
 * After the last lyric, while the music plays on: a few thin lines laid over each other,
 * each one moved by its own part of the music — the bass (deep, slow, swelling on every
 * beat), the mids, the treble (quick, fine ripples) and the whole mix. They meet at both
 * ends like plucked strings, glide smoothly (eased, never jumpy) and settle flat when the
 * music stops.
 */
export function MusicLines({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const g = c.getContext('2d')
    if (!g) return
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    const fit = () => {
      const dpr = Math.min(2, devicePixelRatio || 1)
      w = c.clientWidth
      h = c.clientHeight
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(c)

    // the theme's colours (read again now and then: the theme can change)
    let colours = { main: '#fff', main2: '#ccc', sub: '#888', text: '#fff' }
    let coloursAt = 0
    const readColours = () => {
      const css = getComputedStyle(document.documentElement)
      const v = (k: string, d: string) => css.getPropertyValue(k).trim() || d
      colours = { main: v('--main', '#fff'), main2: v('--main-2', '#ccc'), sub: v('--sub', '#888'), text: v('--text', '#fff') }
    }

    // each line: its colour, thickness, how many waves across, its own drift, how far it
    // moves at rest and with its band at full strength
    const lines = [
      { band: 'level', colour: 'text', alpha: 0.22, width: 1, cycles: 3.1, drift: 0.35, rest: 0.05, gain: 0.6, beat: 0.12 },
      { band: 'high', colour: 'sub', alpha: 0.75, width: 1, cycles: 5.2, drift: 1.1, rest: 0.04, gain: 0.9, beat: 0.05 },
      { band: 'mid', colour: 'main2', alpha: 0.85, width: 1.5, cycles: 2.4, drift: 0.7, rest: 0.06, gain: 0.8, beat: 0.2 },
      { band: 'bass', colour: 'main', alpha: 1, width: 2.2, cycles: 1.25, drift: 0.45, rest: 0.08, gain: 0.75, beat: 0.4 },
    ] as const
    const level = { level: 0, high: 0, mid: 0, bass: 0 }
    const phase = lines.map((_, k) => k * 1.7)
    let pulse = 0
    let lastBeat: number | null = null
    let last = performance.now()
    let raf = 0

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (now - coloursAt > 1000) {
        readColours()
        coloursAt = now
      }
      const f = studio.discoFrame()
      const on = f.playing && !still
      const target = {
        level: on ? f.bands.level : 0,
        high: on ? f.bands.high : 0,
        mid: on ? f.bands.mid : 0,
        bass: on ? Math.max(f.bands.sub, f.bands.bass) : 0,
      }
      // rises quickly, falls slowly: smooth, never twitchy
      for (const k of Object.keys(level) as (keyof typeof level)[]) {
        const rate = target[k] > level[k] ? 10 : 2.5
        level[k] += (target[k] - level[k]) * (1 - Math.exp(-dt * rate))
      }
      if (on && f.beatIndex !== null && f.beatIndex !== lastBeat) {
        if (lastBeat !== null) pulse = 1
        lastBeat = f.beatIndex
      }
      pulse *= Math.exp(-dt / 0.22)

      g.clearRect(0, 0, w, h)
      g.lineCap = 'round'
      g.lineJoin = 'round'
      const cy = h / 2
      const half = h / 2 - 3
      lines.forEach((ln, k) => {
        const e = level[ln.band]
        if (on) phase[k] += dt * ln.drift * (1 + e * 2.2)
        const amp = Math.min(1, ln.rest + ln.gain * e + ln.beat * pulse) * half
        g.beginPath()
        for (let x = 0; x <= w; x += 3) {
          const u = x / w
          const env = Math.pow(Math.sin(Math.PI * u), 1.3) // meets the centre line at both ends
          const wave = Math.sin(2 * Math.PI * ln.cycles * u + phase[k]) * 0.72 + Math.sin(2 * Math.PI * ln.cycles * 1.9 * u - phase[k] * 0.6 + k) * 0.28
          const y = cy + env * amp * wave
          if (x === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.strokeStyle = colours[ln.colour]
        g.globalAlpha = ln.alpha
        g.lineWidth = ln.width
        g.stroke()
      })
      g.globalAlpha = 1
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])
  return <canvas ref={canvas} aria-hidden className={className} />
}
