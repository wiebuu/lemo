// Simulated singers of every level on real analysed songs: is the score where a person
// would put it? Reads songs from LEMO_SIM_SONGS (an analyzer songs folder); skipped
// when that isn't set:
//   LEMO_SIM_SONGS=../analyzer/data/songs LEMO_SIM_N=40 npx vitest run src/lib/calibration.sim.test.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { describe, it } from 'vitest'
import { evaluate, DEFAULT_EVAL } from './evaluation'
import type { ReferenceNote, UserFrame } from './types'

const DIR = process.env.LEMO_SIM_SONGS

interface Level { name: string; noteSd: number; jitter: number; timingSd: number; miss: number; clarity: number; dyn: number; scoop: number; drift: number }
const LEVELS: Level[] = [
  { name: 'perfect', noteSd: 0, jitter: 3, timingSd: 0, miss: 0, clarity: 0.95, dyn: 1, scoop: 0, drift: 0 },
  { name: 'great', noteSd: 15, jitter: 8, timingSd: 0.04, miss: 0.03, clarity: 0.93, dyn: 0.8, scoop: 0.05, drift: 5 },
  { name: 'good', noteSd: 30, jitter: 12, timingSd: 0.07, miss: 0.07, clarity: 0.91, dyn: 0.6, scoop: 0.15, drift: 10 },
  { name: 'average', noteSd: 50, jitter: 18, timingSd: 0.11, miss: 0.12, clarity: 0.88, dyn: 0.4, scoop: 0.3, drift: 20 },
  { name: 'below avg', noteSd: 75, jitter: 25, timingSd: 0.16, miss: 0.2, clarity: 0.85, dyn: 0.25, scoop: 0.45, drift: 30 },
  { name: 'poor', noteSd: 120, jitter: 35, timingSd: 0.25, miss: 0.3, clarity: 0.82, dyn: 0.1, scoop: 0.6, drift: 45 },
  { name: 'random', noteSd: 400, jitter: 40, timingSd: 0.4, miss: 0.35, clarity: 0.8, dyn: 0, scoop: 0.6, drift: 60 },
]

let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())

function simulate(ref: any, L: Level, from: number, to: number, octave = 0): UserFrame[] {
  const c = ref.contour, ld = ref.loudness
  const notes: ReferenceNote[] = ref.notes
  const hop = 1 / 94
  // per-note pitch error and timing; some notes not sung at all
  const per = notes.map(() => ({ off: gauss() * L.noteSd / 100, shift: gauss() * L.timingSd, miss: rnd() < L.miss, scoop: rnd() < L.scoop }))
  const frames: UserFrame[] = []
  let walk = 0
  let ni = 0
  for (let t = from; t < to; t += hop) {
    while (ni < notes.length - 1 && notes[ni].endTime < t) ni++
    const n = notes[ni]
    const inNote = n && t >= n.startTime - 0.05 && t <= n.endTime + 0.05
    const p = per[ni]
    // rushing and dragging: a timing error that drifts from phrase to phrase
    const ts = t - L.timingSd * (0.8 * Math.sin(t * 1.7 + 1) + 0.6 * Math.sin(t * 4.3 + 2))
    const i = Math.round((ts - c.t0) / c.hop)
    const m = c.midi[i]
    walk = walk * 0.97 + gauss() * L.jitter / 100 * 0.25
    const li = Math.round((ts - ld.t0) / ld.hop)
    const refDb = ld.db[li] ?? -20
    if (m == null || (inNote && p.miss)) {
      frames.push({ t, midi: null, clarity: 0.3 + 0.2 * rnd(), level: -55 + 3 * gauss() })
      continue
    }
    let off = inNote ? p.off : 0
    if (inNote && p.scoop && t - n.startTime < 0.12) off -= 0.9 * (1 - (t - n.startTime) / 0.12)
    const drift = L.drift / 100 * Math.sin(t / 7)
    frames.push({
      t,
      midi: m + off + walk + drift + octave + (gauss() * L.jitter) / 300,
      clarity: Math.min(0.99, L.clarity + gauss() * 0.03),
      level: -20 + L.dyn * (refDb - -20) + (1 - L.dyn) * 4 * gauss() + 1.5 * gauss(),
    })
  }
  return frames
}

describe.skipIf(!DIR || !existsSync(DIR))('rating calibration on real songs', () => {
  it('prints scores per level', () => {
    const ids = readdirSync(DIR!).filter((d) => existsSync(`${DIR}/${d}/reference.json`)).slice(0, Number(process.env.LEMO_SIM_N ?? 8))
    const rows: Record<string, number[][]> = {}
    for (const id of ids) {
      const ref = JSON.parse(readFileSync(`${DIR}/${id}/reference.json`, 'utf8'))
      if (!ref.contour || !ref.loudness) continue
      const sung = ref.notes.filter((n: ReferenceNote) => n.sung)
      const from = sung[0].startTime - 1
      const to = Math.min(ref.duration, from + 90)
      for (const L of LEVELS) {
        const fr = simulate(ref, L, from, to, L.name === 'good' ? -12 : 0)
        const ev = evaluate(ref.notes, fr, from, to, DEFAULT_EVAL, ref.harmony, ref.contour)
        const m = ev.metrics
        ;(rows[L.name] ??= []).push([ev.overall.score ?? NaN, m.shape.score ?? NaN, m.harmony.score ?? NaN, m.rhythm.score ?? NaN, m.stability.score ?? NaN, m.tone.score ?? NaN, m.attack.score ?? NaN, m.dynamics.score ?? NaN])
      }
    }
    const f = (x: number) => (Number.isNaN(x) ? '  - ' : String(Math.round(x * 100)).padStart(4))
    console.log(`songs: ${ids.length}\nlevel        overall  shape harm rhyt stab tone attk dyn   (min–max overall)`)
    for (const L of LEVELS) {
      const r = rows[L.name]
      const avg = r[0].map((_, k) => { const v = r.map((x) => x[k]).filter((x) => !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN })
      const ov = r.map((x) => x[0]).filter((x) => !Number.isNaN(x))
      console.log(`${L.name.padEnd(12)} ${f(avg[0])}    ${avg.slice(1).map(f).join(' ')}   (${f(Math.min(...ov))}–${f(Math.max(...ov))})`)
    }
  })
})
