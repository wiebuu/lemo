// Microphone capture. Audio never leaves the browser and nothing is recorded:
// AudioWorklet → Web Worker (YIN) → pitch readings with exact context times.

import type { WorkerReading } from './pitch.worker'

export type MicErrorKind = 'denied' | 'no-device' | 'insecure' | 'busy' | 'unknown'

export class MicError extends Error {
  readonly kind: MicErrorKind
  constructor(kind: MicErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export type MicReading = WorkerReading

const loadedContexts = new WeakSet<BaseAudioContext>()

export class MicInput {
  private stream: MediaStream | null = null
  private source: AudioNode | null = null
  private node: AudioWorkletNode | null = null
  private sink: GainNode | null = null
  private worker: Worker | null = null
  private ownsSource = false
  muted = false
  /** Called for every analysed hop (~94/s), independent of rendering. */
  onReading: ((r: MicReading) => void) | null = null
  /** Raw samples while recording is on (for "hear yourself"). Kept in memory only. */
  onChunk: ((samples: Float32Array, endFrame: number) => void) | null = null
  private recPort: MessagePort | null = null

  get active() {
    return this.node !== null
  }

  async start(ctx: AudioContext): Promise<void> {
    if (this.node) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new MicError('insecure', 'Microphone needs a secure page (https or localhost).')
    }
    setAudioSession('play-and-record') // recording: the phone may switch earphones to call mode
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      })
    } catch (e) {
      const name = (e as DOMException).name
      if (name === 'NotAllowedError' || name === 'SecurityError')
        throw new MicError('denied', 'Microphone permission was denied. Allow it in the browser address bar and try again.')
      if (name === 'NotFoundError' || name === 'OverconstrainedError')
        throw new MicError('no-device', 'No microphone found. Plug one in and try again.')
      if (name === 'NotReadableError') throw new MicError('busy', 'The microphone is in use by another app.')
      throw new MicError('unknown', (e as Error).message)
    }
    this.stream = await preferBuiltInMic(this.stream)
    this.stream.getAudioTracks()[0]?.addEventListener('ended', () => this.stop())
    await this.attach(ctx, ctx.createMediaStreamSource(this.stream), true)
  }

  /**
   * Self-test: analyse an in-graph node (e.g. the guide vocal) through the
   * exact same worklet → worker pipeline as the microphone.
   */
  async startFromNode(ctx: AudioContext, node: AudioNode) {
    this.stop()
    await this.attach(ctx, node, false)
  }

  private async attach(ctx: AudioContext, source: AudioNode, owns: boolean) {
    if (!loadedContexts.has(ctx)) {
      await ctx.audioWorklet.addModule('/capture-worklet.js')
      loadedContexts.add(ctx)
    }
    this.source = source
    this.ownsSource = owns
    this.node = new AudioWorkletNode(ctx, 'lemo-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 })
    // Keep the node pulled by the graph without making any sound (no feedback/monitoring).
    this.sink = ctx.createGain()
    this.sink.gain.value = 0
    source.connect(this.node)
    this.node.connect(this.sink).connect(ctx.destination)

    this.worker = new Worker(new URL('./pitch.worker.ts', import.meta.url), { type: 'module' })
    const ch = new MessageChannel()
    this.node.port.postMessage({ port: ch.port1 }, [ch.port1])
    this.worker.postMessage({ type: 'init', sampleRate: ctx.sampleRate, port: ch.port2 }, [ch.port2])
    const rec = new MessageChannel()
    this.node.port.postMessage({ recPort: rec.port1 }, [rec.port1])
    this.recPort = rec.port2
    this.recPort.onmessage = (e: MessageEvent<{ samples: Float32Array; endFrame: number }>) => {
      // While muted, record silence (not nothing) so the take stays aligned with the song.
      this.onChunk?.(this.muted ? new Float32Array(e.data.samples.length) : e.data.samples, e.data.endFrame)
    }
    this.worker.onmessage = (e: MessageEvent<MicReading>) => {
      const r = this.muted ? { ...e.data, level: 0, midi: null, kind: 'silence' as const } : e.data
      this.onReading?.(r)
    }
  }

  /** Start/stop sending raw samples to onChunk. */
  setRecording(on: boolean) {
    this.node?.port.postMessage({ record: on })
  }

  get sampleRate(): number {
    return this.node?.context.sampleRate ?? 48000
  }

  /** The microphone in use (e.g. "AirPods Pro"), once it's on. */
  get deviceLabel(): string {
    return this.stream?.getAudioTracks()[0]?.label ?? ''
  }

  stop() {
    this.recPort?.close()
    this.recPort = null
    this.stream?.getTracks().forEach((t) => t.stop())
    if (this.source && this.node) {
      try {
        this.source.disconnect(this.node)
      } catch {
        /* already disconnected */
      }
    }
    if (this.ownsSource) this.source?.disconnect()
    this.node?.port.close()
    this.node?.disconnect()
    this.sink?.disconnect()
    this.worker?.terminate()
    this.stream = null
    this.source = null
    this.node = null
    this.sink = null
    this.worker = null
    setAudioSession('playback') // back to full-quality music
  }
}

/**
 * iPhones (Safari): once a page has used the microphone, its audio stays in "call" mode
 * (thin, mono, a buzz on Bluetooth earphones) even after the mic is off, unless the page
 * says it's music again. Safari 16.4+ lets it; elsewhere this does nothing.
 */
export function setAudioSession(type: 'playback' | 'play-and-record') {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (!session) return
  try {
    session.type = type
  } catch {
    /* not allowed here */
  }
}

// not "headset" alone: Android names wired earphones' mic "Headset earpiece" / "Wired
// headset", and moving off that mic sent the sound to the phone's speaker instead
const BLUETOOTH = /airpods|buds|bluetooth|hands-?free|\bbt\b|\bsco\b/i

/** True when this mic is a Bluetooth headset's (its use puts the earphones in call mode). */
export const isBluetoothMic = (label: string) => BLUETOOTH.test(label)

/**
 * Bluetooth earphones drop to call quality (thin, mono, a buzz) while their own mic
 * records. With the phone's built-in mic instead, they can stay in music mode — and it
 * hears your voice, not the song (that's only in your ears). Swaps to it when there is one.
 */
async function preferBuiltInMic(stream: MediaStream): Promise<MediaStream> {
  const label = stream.getAudioTracks()[0]?.label ?? ''
  if (!isBluetoothMic(label)) return stream
  try {
    const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default')
    const builtIn = mics.find((d) => !isBluetoothMic(d.label) && /iphone|built-?in|phone|internal|bottom|microphone/i.test(d.label))
      ?? mics.find((d) => d.label && !isBluetoothMic(d.label))
    if (!builtIn) return stream
    const other = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: builtIn.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    })
    stream.getTracks().forEach((t) => t.stop()) // let go of the earphones' mic
    return other
  } catch {
    return stream // keep the one that works
  }
}
