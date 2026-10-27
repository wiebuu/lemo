// Web Worker: sliding 2048-sample window, YIN + tracker every 512-sample hop
// (~94 analyses/s at 48 kHz). Runs regardless of tab visibility or render rate.

import { PitchTracker } from '../lib/pitch/tracker'
import { rms, yin } from '../lib/pitch/yin'

const WINDOW = 2048
let sampleRate = 48000
const win = new Float32Array(WINDOW)
const scratch = new Float32Array(WINDOW)
const tracker = new PitchTracker()

export interface WorkerReading {
  ctxTime: number
  level: number
  midi: number | null
  clarity: number
  kind: 'silence' | 'noise' | 'voiced'
}

self.onmessage = (e: MessageEvent) => {
  const d = e.data
  if (d.type === 'init') {
    sampleRate = d.sampleRate
    tracker.reset()
    win.fill(0)
    const port: MessagePort = d.port
    port.onmessage = (m: MessageEvent<{ samples: Float32Array; endFrame: number }>) => {
      const { samples, endFrame } = m.data
      win.copyWithin(0, samples.length)
      win.set(samples, WINDOW - samples.length)
      const level = rms(win)
      const est = level > 0.004 ? yin(win, { sampleRate }, scratch) : null
      const p = tracker.push(est, level)
      const reading: WorkerReading = {
        ctxTime: (endFrame - WINDOW / 2) / sampleRate,
        level,
        midi: p.midi,
        clarity: p.clarity,
        kind: p.kind,
      }
      ;(self as unknown as Worker).postMessage(reading)
    }
  } else if (d.type === 'reset') {
    tracker.reset()
  }
}
