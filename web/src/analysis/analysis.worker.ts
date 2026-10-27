/// <reference lib="webworker" />
// Analyses a song on this device, off the main thread: vocals out (Demucs), their
// pitch (CREPE), and both parts compressed for the upload. Same models as the server.

import * as ort from 'onnxruntime-web/webgpu'
import { AudioSample, AudioSampleSource, BufferTarget, canEncodeAudio, Mp3OutputFormat, Mp4OutputFormat, Output, WebMOutputFormat } from 'mediabunny'
import { registerMp3Encoder } from '@mediabunny/mp3-encoder'
import { chunks, CREPE_SR, decode, frames, HOP, toCrepeRate } from './crepe'
import { SAMPLE_RATE, separate } from './demucs/separate'

export type WorkerIn =
  | { type: 'start'; channels: Float32Array[]; demucs: ArrayBuffer; crepe: ArrayBuffer }
  | { type: 'stop' }

export type WorkerOut =
  | { type: 'progress'; stage: 'separating' | 'melody' | 'encoding'; done: number; total: number }
  | { type: 'done'; vocals: ArrayBuffer; music: ArrayBuffer; ext: string; f0: Float32Array; periodicity: Float32Array }
  | { type: 'error'; message: string }

ort.env.wasm.numThreads = 1 // threads need cross-origin isolation, which would break sign-in
ort.env.logLevel = 'error'

let stop = false
const post = (m: WorkerOut, transfer: Transferable[] = []) => postMessage(m, transfer)

addEventListener('message', (e: MessageEvent<WorkerIn>) => {
  if (e.data.type === 'stop') stop = true
  else void run(e.data).catch((err) => post({ type: 'error', message: friendly(err) }))
})

function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/abort|stopped/i.test(msg)) return 'stopped'
  if (/memory|allocation|out of/i.test(msg)) return 'This device ran out of memory while analysing.'
  if (/webgpu|adapter|device lost/i.test(msg)) return 'This device’s graphics chip stopped responding.'
  return msg
}

async function run({ channels, demucs, crepe }: Extract<WorkerIn, { type: 'start' }>) {
  stop = false
  const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }

  // 1. vocals and music
  let session = await ort.InferenceSession.create(new Uint8Array(demucs), opts)
  const { vocals, music } = await separate(ort, session, channels, (done, total) => post({ type: 'progress', stage: 'separating', done, total }), () => stop)
  await session.release()
  channels.length = 0 // the mix isn't needed any more
  for (const ch of [...vocals, ...music]) if (!ch.every(Number.isFinite)) throw new Error('The separation went wrong on this device (invalid audio).')

  // 2. the vocals' pitch, in the server's 30-second chunks
  const voice = toCrepeRate(vocals, SAMPLE_RATE)
  session = await ort.InferenceSession.create(new Uint8Array(crepe), opts)
  const parts = chunks(voice.length)
  const totalFrames = parts.reduce((n, [s, e]) => n + Math.floor((e - s) / HOP) + 1, 0)
  const f0: Float32Array[] = []
  const per: Float32Array[] = []
  let doneFrames = 0
  for (const [s, e] of parts) {
    const { data, count } = frames(voice.subarray(s, e))
    const probs = new Float32Array(count * 360)
    const BATCH = 512
    for (let b = 0; b < count; b += BATCH) {
      if (stop) throw new Error('stopped')
      const n = Math.min(BATCH, count - b)
      const out = await session.run({ frames: new ort.Tensor('float32', data.subarray(b * 1024, (b + n) * 1024), [n, 1024]) })
      probs.set(out.probs.data as Float32Array, b * 360)
      out.probs.dispose()
      doneFrames += n
      post({ type: 'progress', stage: 'melody', done: doneFrames, total: totalFrames })
    }
    const dec = decode(probs, count)
    const keep = e < voice.length ? Math.floor((e - s) / HOP) : count // drop the padded tail frame between chunks
    f0.push(dec.f0.subarray(0, keep))
    per.push(dec.periodicity.subarray(0, keep))
  }
  await session.release()
  const join = (xs: Float32Array[]) => {
    const out = new Float32Array(xs.reduce((n, x) => n + x.length, 0))
    let o = 0
    for (const x of xs) out.set(x, (o += x.length) - x.length)
    return out
  }

  // 3. compress both parts for the upload
  const { format, codec, ext } = await pickEncoder()
  const encodeOne = async (chs: Float32Array[], step: number) => {
    const output = new Output({ format, target: new BufferTarget() })
    const source = new AudioSampleSource({ codec, bitrate: 160_000 })
    output.addAudioTrack(source)
    await output.start()
    const n = chs[0].length
    const block = SAMPLE_RATE // one second at a time
    for (let i = 0; i < n; i += block) {
      if (stop) throw new Error('stopped')
      const len = Math.min(block, n - i)
      const planar = new Float32Array(2 * len)
      planar.set(chs[0].subarray(i, i + len), 0)
      planar.set(chs[1].subarray(i, i + len), len)
      const sample = new AudioSample({ data: planar, format: 'f32-planar', numberOfChannels: 2, sampleRate: SAMPLE_RATE, timestamp: i / SAMPLE_RATE })
      await source.add(sample)
      sample.close()
      post({ type: 'progress', stage: 'encoding', done: step * n + i + len, total: 2 * n })
    }
    source.close()
    await output.finalize()
    return output.target.buffer!
  }
  const v = await encodeOne(vocals, 0)
  const m = await encodeOne(music, 1)
  const pitch = join(f0)
  const periodicity = join(per)
  post({ type: 'done', vocals: v, music: m, ext, f0: pitch, periodicity }, [v, m, pitch.buffer, periodicity.buffer])
}

async function pickEncoder() {
  const opts = { numberOfChannels: 2, sampleRate: SAMPLE_RATE, bitrate: 160_000 }
  if (await canEncodeAudio('aac', opts)) return { format: new Mp4OutputFormat(), codec: 'aac' as const, ext: '.m4a' }
  if (await canEncodeAudio('opus', opts)) return { format: new WebMOutputFormat(), codec: 'opus' as const, ext: '.webm' }
  registerMp3Encoder() // no built-in encoder: a small MP3 encoder that works everywhere
  return { format: new Mp3OutputFormat(), codec: 'mp3' as const, ext: '.mp3' }
}

export { CREPE_SR }
