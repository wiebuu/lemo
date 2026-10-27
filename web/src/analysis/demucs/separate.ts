// Vocal separation with htdemucs in the browser (ONNX Runtime, WebGPU) — the same
// model the server uses. Adapted from demucs-js by Kevin Gibbons and contributors
// (https://github.com/bakkot/demucs-js), MIT License — see LICENSE-demucs-js.md.
// Changes: keeps only two results (vocals, and everything else = the music) to save
// memory, and reports progress / can be stopped between chunks.

import type * as Ort from 'onnxruntime-web'
import { ispec, magnitude, spec, type Tensor } from './dsp'

export const SAMPLE_RATE = 44100
const SEGMENT = 7.8 // seconds the model was trained on
const SOURCES = ['drums', 'bass', 'other', 'vocals'] as const
const VOCALS = SOURCES.indexOf('vocals')

/** Zero-padded slice [offset - (target - length) / 2, …) of the last axis. */
function padded(mix: Tensor, offset: number, length: number, target: number): Tensor {
  const total = mix.shape[mix.shape.length - 1]
  const delta = target - length
  const start = offset - Math.floor(delta / 2)
  const from = Math.max(0, start)
  const to = Math.min(total, start + target)
  const rows = mix.data.length / total
  const out = new Float32Array(rows * target)
  for (let r = 0; r < rows; r++) out.set(mix.data.subarray(r * total + from, r * total + to), r * target + (from - start))
  return { data: out, shape: [...mix.shape.slice(0, -1), target] }
}

/** The model's frequency branch gives real/imag interleaved as channels: split them. */
function toComplex(m: Tensor) {
  const [B, S, C, Fr, T] = m.shape
  const half = C / 2
  const shape = [B, S, half, Fr, T]
  const size = B * S * half * Fr * T
  const real = new Float32Array(size)
  const imag = new Float32Array(size)
  const plane = Fr * T
  for (let bs = 0; bs < B * S; bs++) {
    for (let c = 0; c < half; c++) {
      const src = (bs * C + 2 * c) * plane
      const dst = (bs * half + c) * plane
      real.set(m.data.subarray(src, src + plane), dst)
      imag.set(m.data.subarray(src + plane, src + 2 * plane), dst)
    }
  }
  return { real: { data: real, shape }, imag: { data: imag, shape } }
}

async function runChunk(ort: typeof Ort, session: Ort.InferenceSession, mix: Tensor, offset: number, length: number): Promise<Tensor> {
  const training = Math.floor(SEGMENT * SAMPLE_RATE)
  const x = padded(mix, offset, length, training)
  const mag = magnitude(spec(x))
  const feeds: Record<string, Ort.Tensor> = {
    [session.inputNames[0]]: new ort.Tensor('float32', x.data, x.shape as number[]),
    [session.inputNames[1]]: new ort.Tensor('float32', mag.data, mag.shape as number[]),
  }
  const res = await session.run(feeds)
  const outX = res[session.outputNames[0]]
  const outXt = res[session.outputNames[1]]
  const freq = ispec(toComplex({ data: outX.data as Float32Array, shape: outX.dims }), training)
  const time = outXt.data as Float32Array
  const sum = new Float32Array(time.length)
  for (let i = 0; i < sum.length; i++) sum[i] = time[i] + freq.data[i]
  const channels = outXt.dims[2]
  outX.dispose()
  outXt.dispose()
  // centre-trim back to the chunk's own length: shape [1, sources, channels, length]
  const trim = Math.floor((training - length) / 2)
  const rows = sum.length / training
  const out = new Float32Array(rows * length)
  for (let r = 0; r < rows; r++) out.set(sum.subarray(r * training + trim, r * training + trim + length), r * length)
  return { data: out, shape: [1, SOURCES.length, channels, length] }
}

export interface Separated {
  vocals: Float32Array[]
  music: Float32Array[]
}

/**
 * Splits a stereo song (44.1 kHz) into vocals and music, 7.8-second chunks with a
 * quarter overlap, blended with a triangle window — as Demucs does.
 */
export async function separate(
  ort: typeof Ort,
  session: Ort.InferenceSession,
  channels: Float32Array[],
  onProgress: (done: number, total: number) => void,
  stopped: () => boolean,
): Promise<Separated> {
  const n = channels[0].length
  const C = 2
  const planar = new Float32Array(C * n)
  planar.set(channels[0], 0)
  planar.set(channels[1] ?? channels[0], n)
  const mix: Tensor = { data: planar, shape: [1, C, n] }

  const segment = Math.floor(SAMPLE_RATE * SEGMENT)
  const stride = Math.floor(0.75 * segment)
  const weight = new Float32Array(segment)
  for (let i = 0; i < segment; i++) weight[i] = i <= segment / 2 ? i + 1 : segment - i
  const wmax = Math.max(...weight.subarray(Math.floor(segment / 2) - 1, Math.floor(segment / 2) + 2))
  for (let i = 0; i < segment; i++) weight[i] /= wmax

  const vocals = [new Float32Array(n), new Float32Array(n)]
  const music = [new Float32Array(n), new Float32Array(n)]
  const sumW = new Float32Array(n)
  const total = Math.ceil(n / stride)
  onProgress(0, total)
  let k = 0
  for (let offset = 0; offset < n; offset += stride) {
    if (stopped()) throw new DOMException('stopped', 'AbortError')
    const len = Math.min(segment, n - offset)
    const out = await runChunk(ort, session, mix, offset, len)
    for (let s = 0; s < SOURCES.length; s++) {
      const into = s === VOCALS ? vocals : music
      for (let c = 0; c < C; c++) {
        const src = (s * C + c) * len
        const dst = into[c]
        for (let t = 0; t < len; t++) dst[offset + t] += weight[t] * out.data[src + t]
      }
    }
    for (let t = 0; t < len; t++) sumW[offset + t] += weight[t]
    onProgress(++k, total)
  }
  for (const arr of [...vocals, ...music]) for (let t = 0; t < n; t++) arr[t] /= sumW[t]
  return { vocals, music }
}
