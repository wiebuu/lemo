// YIN monophonic pitch estimator (de Cheveigné & Kawahara, 2002).
// Pure function: no Web Audio dependency, so it is unit-testable with synthetic signals.

export interface YinOptions {
  sampleRate: number
  /** Absolute threshold on the cumulative mean normalised difference. */
  threshold?: number
  minFreq?: number
  maxFreq?: number
}

export interface PitchEstimate {
  freq: number
  /** 1 - d'(tau): ~1 for clean periodic signals, lower for noisy ones. */
  clarity: number
}

/**
 * Estimate the fundamental frequency of `buf`. Returns null when no period
 * passes the threshold (noise, breath, unvoiced consonants, silence).
 * `scratch` can be passed to avoid allocating per frame.
 */
/** Deepest dip still accepted when nothing passes the threshold (clarity ≥ 0.65). */
const FALLBACK_MAX_D = 0.35

export function yin(buf: Float32Array, opts: YinOptions, scratch?: Float32Array): PitchEstimate | null {
  const { sampleRate, threshold = 0.15, minFreq = 65, maxFreq = 1100 } = opts
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq))
  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buf.length / 2))
  if (maxTau <= minTau) return null
  const w = buf.length - maxTau
  const d = scratch && scratch.length >= maxTau + 1 ? scratch : new Float32Array(maxTau + 1)

  // Step 2: difference function.
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0
    for (let i = 0; i < w; i++) {
      const delta = buf[i] - buf[i + tau]
      sum += delta * delta
    }
    d[tau] = sum
  }

  // Step 3: cumulative mean normalised difference.
  d[0] = 1
  let running = 0
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau]
    d[tau] = running > 0 ? (d[tau] * tau) / running : 1
  }

  // Step 4: first dip below threshold, then walk to its local minimum.
  let tau = -1
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++
      tau = t
      break
    }
  }
  if (tau === -1) {
    // No dip below the threshold (a breathy or slightly noisy voice): take the deepest
    // dip if it's still clearly periodic. Its lower clarity lets the tracker decide.
    let best = -1
    for (let t = minTau; t <= maxTau; t++) if (best === -1 || d[t] < d[best]) best = t
    if (best === -1 || d[best] >= FALLBACK_MAX_D) return null
    tau = best
  }

  // Step 5: parabolic interpolation for sub-sample accuracy.
  let betterTau = tau
  if (tau > 1 && tau < maxTau) {
    const s0 = d[tau - 1], s1 = d[tau], s2 = d[tau + 1]
    const denom = 2 * (2 * s1 - s2 - s0)
    if (denom !== 0) betterTau = tau + (s2 - s0) / denom
  }
  return { freq: sampleRate / betterTau, clarity: Math.max(0, Math.min(1, 1 - d[tau])) }
}

export function rms(buf: Float32Array): number {
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
  return Math.sqrt(s / buf.length)
}
