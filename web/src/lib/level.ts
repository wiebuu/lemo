// Your take, levelled for listening back. The microphone is recorded raw (no automatic
// gain: it would bend the pitch tracking), so a take is often much quieter than the
// mastered song it's played with. Here the sung parts are brought to a steady level,
// and the loudest moments are softly limited so nothing clips. Scoring never uses this.

const TARGET_RMS = 0.12 // ≈ -18 dBFS while singing
const MAX_GAIN = 12 // ≈ +22 dB: enough for a quiet laptop mic, not so much it's all noise
const FRAME = 1024

/** The gain that brings the sung parts (the louder frames, not the silences) to the target. */
export function takeGain(samples: Float32Array): number {
  const levels: number[] = []
  for (let i = 0; i + FRAME <= samples.length; i += FRAME) {
    let s = 0
    for (let j = i; j < i + FRAME; j++) s += samples[j] * samples[j]
    levels.push(Math.sqrt(s / FRAME))
  }
  if (!levels.length) return 1
  levels.sort((a, b) => a - b)
  // the top third of the frames: where you're singing
  const sung = levels.slice(Math.floor(levels.length * 2 / 3))
  const rms = Math.sqrt(sung.reduce((a, x) => a + x * x, 0) / sung.length)
  if (rms < 1e-4) return 1 // silence: nothing to bring up
  return Math.max(1, Math.min(MAX_GAIN, TARGET_RMS / rms))
}

/** A levelled copy of the take; peaks are rounded off smoothly instead of clipping. */
export function levelTake(samples: Float32Array): Float32Array {
  const g = takeGain(samples)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i] * g
    // linear up to 0.8, then a soft knee that levels off at 0.98 (never clips)
    const a = Math.abs(x)
    out[i] = a <= 0.8 ? x : Math.sign(x) * (0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18))
  }
  return out
}
