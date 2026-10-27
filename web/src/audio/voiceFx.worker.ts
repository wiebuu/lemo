/// <reference lib="webworker" />
// Re-renders a take with a new pitch / tune, off the main thread (so sliders and
// playback never stutter). Keeps the original take; the newest request wins.

import { pitchShift } from '../lib/voiceFx'

export type FxIn =
  | { type: 'take'; samples: Float32Array; sampleRate: number }
  | { type: 'render'; id: number; semitones: Float32Array; step: number }

export type FxOut = { type: 'rendered'; id: number; samples: Float32Array }

let take: { samples: Float32Array; sampleRate: number } | null = null
let latest = 0

addEventListener('message', (e: MessageEvent<FxIn>) => {
  const m = e.data
  if (m.type === 'take') {
    take = { samples: m.samples, sampleRate: m.sampleRate }
    return
  }
  latest = m.id
  // let a burst of slider moves settle: only the last one is rendered
  setTimeout(() => {
    if (m.id !== latest || !take) return
    const out = pitchShift(take.samples, take.sampleRate, m.semitones, m.step)
    postMessage({ type: 'rendered', id: m.id, samples: out } satisfies FxOut, [out.buffer])
  }, 0)
})
