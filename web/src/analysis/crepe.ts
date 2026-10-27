// Pitch tracking of the separated vocals with CREPE "full" — the same model and the
// same steps as the server (torchcrepe.predict with Viterbi decoding, in 30-second
// chunks), so a song analysed on a device gets the same melody. The filters that
// follow (median / mean) are applied by the server when the result arrives.

export const CREPE_SR = 16000
export const HOP = 160 // 10 ms
const WINDOW = 1024
const BINS = 360
const CENTS_PER_BIN = 20
const CENTS_OFFSET = 1997.3794084376191
const FMIN = 65
const FMAX = 1100

const hzToCents = (f: number) => 1200 * Math.log2(f / 10)
const MIN_BIN = Math.floor((hzToCents(FMIN) - CENTS_OFFSET) / CENTS_PER_BIN)
const MAX_BIN = Math.ceil((hzToCents(FMAX) - CENTS_OFFSET) / CENTS_PER_BIN)

export const binToHz = (bin: number) => 10 * 2 ** ((CENTS_PER_BIN * bin + CENTS_OFFSET) / 1200)

/** Downmix to mono and resample 44.1 kHz → 16 kHz (windowed-sinc low-pass). */
export function toCrepeRate(channels: Float32Array[], fromRate: number): Float32Array {
  const n = channels[0].length
  const mono = new Float32Array(n)
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length
  const ratio = fromRate / CREPE_SR
  const outLen = Math.ceil(n / ratio)
  const out = new Float32Array(outLen)
  const cutoff = 0.95 * (CREPE_SR / 2) / fromRate // normalised to the input rate
  const half = 32 // taps each side (in input samples, at the output's cutoff)
  const span = Math.ceil(half * ratio)
  for (let i = 0; i < outLen; i++) {
    const centre = i * ratio
    const lo = Math.max(0, Math.ceil(centre - span))
    const hi = Math.min(n - 1, Math.floor(centre + span))
    let acc = 0
    let wsum = 0
    for (let j = lo; j <= hi; j++) {
      const x = j - centre
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (span + 1)) // Hann
      acc += mono[j] * sinc * w
      wsum += sinc * w
    }
    out[i] = wsum ? acc / wsum : 0
  }
  return out
}

/** The network's input for one chunk: 1024-sample frames every 10 ms, zero-padded
 * by half a window, each frame mean-centred and scaled to unit (sample) std. */
export function frames(audio: Float32Array): { data: Float32Array; count: number } {
  const count = 1 + Math.floor(audio.length / HOP)
  const pad = WINDOW / 2
  const data = new Float32Array(count * WINDOW)
  for (let f = 0; f < count; f++) {
    const start = f * HOP - pad
    const row = data.subarray(f * WINDOW, (f + 1) * WINDOW)
    let mean = 0
    for (let k = 0; k < WINDOW; k++) {
      const idx = start + k
      const v = idx >= 0 && idx < audio.length ? audio[idx] : 0
      row[k] = v
      mean += v
    }
    mean /= WINDOW
    let ss = 0
    for (let k = 0; k < WINDOW; k++) {
      row[k] -= mean
      ss += row[k] * row[k]
    }
    const std = Math.max(1e-10, Math.sqrt(ss / (WINDOW - 1)))
    for (let k = 0; k < WINDOW; k++) row[k] /= std
  }
  return { data, count }
}

/**
 * torchcrepe's Viterbi decoding: bins outside 65–1100 Hz are removed, each frame's
 * scores are softmax-normalised, and the path may move at most 11 bins per frame
 * (triangular transition weights). Returns pitch (Hz) and periodicity per frame.
 */
export function decode(probs: Float32Array, count: number): { f0: Float32Array; periodicity: Float32Array } {
  const TINY = 1.1754944e-38 // librosa adds the smallest float before taking logs
  const reach = 11
  // log transition weights by distance
  const rowSum = new Float64Array(BINS)
  for (let i = 0; i < BINS; i++) for (let j = 0; j < BINS; j++) rowSum[i] += Math.max(12 - Math.abs(i - j), 0)
  const W = 2 * reach + 1
  const logTrans = new Float64Array(BINS * W) // [from][to - from + reach]
  for (let i = 0; i < BINS; i++) for (let d = -reach; d <= reach; d++) logTrans[i * W + d + reach] = Math.log((12 - Math.abs(d)) / rowSum[i] + TINY)

  const logObs = new Float64Array(count * BINS)
  for (let t = 0; t < count; t++) {
    let max = -Infinity
    for (let b = MIN_BIN; b < MAX_BIN; b++) max = Math.max(max, probs[t * BINS + b])
    let sum = 0
    for (let b = MIN_BIN; b < MAX_BIN; b++) sum += Math.exp(probs[t * BINS + b] - max)
    for (let b = 0; b < BINS; b++) {
      const p = b >= MIN_BIN && b < MAX_BIN ? Math.exp(probs[t * BINS + b] - max) / sum : 0
      logObs[t * BINS + b] = Math.log(p + TINY)
    }
  }
  const back = new Int16Array(count * BINS)
  let prev = new Float64Array(BINS)
  let cur = new Float64Array(BINS)
  for (let b = 0; b < BINS; b++) prev[b] = Math.log(1 / BINS) + logObs[b]
  for (let t = 1; t < count; t++) {
    for (let j = 0; j < BINS; j++) {
      let best = -Infinity
      let arg = j
      for (let i = Math.max(0, j - reach); i <= Math.min(BINS - 1, j + reach); i++) {
        const v = prev[i] + logTrans[i * W + j - i + reach]
        if (v > best) {
          best = v
          arg = i
        }
      }
      cur[j] = best + logObs[t * BINS + j]
      back[t * BINS + j] = arg
    }
    ;[prev, cur] = [cur, prev]
  }
  let last = 0
  for (let b = 1; b < BINS; b++) if (prev[b] > prev[last]) last = b
  const f0 = new Float32Array(count)
  const periodicity = new Float32Array(count)
  for (let t = count - 1; t >= 0; t--) {
    f0[t] = binToHz(last)
    periodicity[t] = last >= MIN_BIN && last < MAX_BIN ? probs[t * BINS + last] : 0
    if (t > 0) last = back[t * BINS + last]
  }
  return { f0, periodicity }
}

/** The server's chunking: 30 s pieces, a tail shorter than a second rides along. */
export function chunks(length: number): [number, number][] {
  const size = 30 * CREPE_SR
  const out: [number, number][] = []
  for (let start = 0; start < length; ) {
    const end = length - (start + size) < CREPE_SR ? length : start + size
    out.push([start, end])
    start = end
  }
  return out
}
