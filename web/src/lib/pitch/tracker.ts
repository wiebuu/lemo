// Turns raw per-window estimates into a stable pitch track:
// silence gate → confidence filter → short median (kills octave blips)
// → light smoothing that snaps on real note changes (keeps vibrato, low latency).

import { freqToMidi } from '../music'
import type { PitchEstimate } from './yin'

export interface TrackerOptions {
  /** Below this RMS the frame is treated as silence. */
  silenceRms: number
  /** Minimum YIN clarity to start a sung note. */
  minClarity: number
  /** Once singing, a frame this clear still counts — if it continues the same pitch
      (a breathier moment mid-note shouldn't cut the line). */
  keepClarity: number
  /** Unvoiced frames tolerated inside a sung note before the line breaks. */
  holdFrames: number
  /** Smoothing factor for small movements (0 = none, 1 = frozen). */
  smoothing: number
}

export const DEFAULT_TRACKER: TrackerOptions = {
  silenceRms: 0.008,
  minClarity: 0.8,
  keepClarity: 0.62,
  holdFrames: 5,
  smoothing: 0.35,
}

export interface TrackedPitch {
  midi: number | null
  clarity: number
  /** 'silence' (too quiet), 'noise' (loud but not periodic), 'voiced'. */
  kind: 'silence' | 'noise' | 'voiced'
}

export class PitchTracker {
  private recent: number[] = []
  private smoothed: number | null = null
  private misses = 0
  private opts: TrackerOptions

  constructor(opts: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULT_TRACKER, ...opts }
  }

  reset() {
    this.recent = []
    this.smoothed = null
    this.misses = 0
  }

  push(estimate: PitchEstimate | null, level: number): TrackedPitch {
    const { silenceRms, minClarity, keepClarity, holdFrames, smoothing } = this.opts
    // hysteresis: starting a note needs a clean frame; continuing one is allowed a breathier
    // frame as long as the pitch carries on (within 1.5 semitones of where it was)
    const continues =
      this.smoothed !== null && !!estimate && estimate.clarity >= keepClarity && Math.abs(freqToMidi(estimate.freq) - this.smoothed) < 1.5
    const kind: TrackedPitch['kind'] =
      level < silenceRms ? 'silence' : !estimate || (estimate.clarity < minClarity && !continues) ? 'noise' : 'voiced'

    if (kind !== 'voiced' || !estimate) {
      this.misses++
      if (this.misses > holdFrames) {
        this.recent = []
        this.smoothed = null
      }
      return { midi: null, clarity: estimate?.clarity ?? 0, kind }
    }
    this.misses = 0

    const raw = freqToMidi(estimate.freq)
    this.recent.push(raw)
    if (this.recent.length > 3) this.recent.shift()
    const med = median3(this.recent)

    if (this.smoothed === null || Math.abs(med - this.smoothed) > 0.75) {
      this.smoothed = med // real note change: snap, no lag
    } else {
      this.smoothed = this.smoothed * smoothing + med * (1 - smoothing)
    }
    return { midi: this.smoothed, clarity: estimate.clarity, kind }
  }
}

function median3(v: number[]): number {
  if (v.length < 3) return v[v.length - 1]
  const [a, b, c] = v
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
}
