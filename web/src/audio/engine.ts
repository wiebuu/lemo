// Sample-accurate playback of backing + guide (lead vocal) stems on one
// AudioContext clock. Speed / transpose are handled by loading a *rendered
// variant* of the stems (synth re-render for the demo, Rubber Band on the
// analyzer for real songs) — never by resampling, so pitch and timing stay true.

import { clampSeek, ctxTimeFor, loopJump, songTimeAt, type ClockAnchor, type LoopRegion } from '../lib/timeline'
import { VoiceChain } from './voiceChain'

export interface StemSet {
  backing: AudioBuffer
  guide?: AudioBuffer
}

export interface AudioSource {
  duration: number
  hasGuide: boolean
  canSpeed: boolean
  canTranspose: boolean
  /** Render/fetch stems for this speed + transpose. */
  load(ctx: BaseAudioContext, speed: number, semitones: number, signal: AbortSignal): Promise<StemSet>
}

type Listener = () => void

export class PlaybackEngine {
  readonly ctx: AudioContext
  private backingGain: GainNode
  private guideGain: GainNode
  private metroGain: GainNode
  private voiceGain: GainNode
  /** Listens to the music (for the disco lights' beat): never routed to the speakers. */
  private musicTap: AnalyserNode
  private tapData: Uint8Array<ArrayBuffer> | null = null
  /** The singer's own recorded take, placed on the song timeline (replay mode). */
  private voice: { buffer: AudioBuffer; start: number } | null = null
  private voiceNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null
  /** Echo, reverb and tone on your voice when you listen back (results screen). */
  readonly voiceChain: VoiceChain
  private nodes: AudioBufferSourceNode[] = []
  private anchor: ClockAnchor | null = null
  private pausedAt = 0
  private stems: StemSet | null = null
  private source: AudioSource | null = null
  private variants = new Map<string, StemSet>()
  private loadAbort: AbortController | null = null
  private listeners = new Set<Listener>()
  private nextBeat = -1

  speed = 1
  semitones = 0
  loop: LoopRegion | null = null
  /** Results mode: playback and seeking stay inside this section (the part that was sung). */
  window: { start: number; end: number } | null = null
  metronome = false
  tempo: number | null = null
  firstBeat = 0
  beatsPerBar = 4
  duration = 0
  /** Emitted when the loop wraps or a seek happens (used to split takes). */
  onDiscontinuity: (() => void) | null = null
  onEnded: (() => void) | null = null

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.backingGain = this.ctx.createGain()
    this.guideGain = this.ctx.createGain()
    this.metroGain = this.ctx.createGain()
    this.metroGain.gain.value = 0.35
    this.voiceGain = this.ctx.createGain()
    for (const g of [this.backingGain, this.guideGain, this.metroGain, this.voiceGain]) g.connect(this.ctx.destination)
    this.voiceChain = new VoiceChain(this.ctx, this.voiceGain)
    this.musicTap = this.ctx.createAnalyser()
    this.musicTap.fftSize = 2048
    this.musicTap.smoothingTimeConstant = 0.15
    this.backingGain.connect(this.musicTap)
  }

  /**
   * The music right now, by band (0..1 each): sub (kick, 35–90 Hz), bass (90–250),
   * mid (snare, claps, 1–4 kHz), high (hi-hats, 6–14 kHz) and overall level.
   */
  bands(): { sub: number; bass: number; mid: number; high: number; level: number } {
    if (!this.anchor) return { sub: 0, bass: 0, mid: 0, high: 0, level: 0 }
    const n = this.musicTap.frequencyBinCount
    this.tapData ??= new Uint8Array(n)
    const d = this.tapData
    this.musicTap.getByteFrequencyData(d)
    const hz = this.ctx.sampleRate / this.musicTap.fftSize
    const band = (lo: number, hi: number) => {
      const a = Math.max(1, Math.floor(lo / hz))
      const b = Math.min(n, Math.max(a + 1, Math.ceil(hi / hz)))
      let sum = 0
      for (let i = a; i < b; i++) sum += d[i]
      return sum / (b - a) / 255
    }
    return { sub: band(35, 90), bass: band(90, 250), mid: band(1000, 4000), high: band(6000, 14000), level: band(35, 14000) }
  }

  /** How hard the low end (kick, bass) is hitting right now, 0..1. */
  bassLevel(): number {
    return this.bands().sub
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }

  get playing() {
    return this.anchor !== null
  }

  /** Output latency the browser reports (seconds). */
  get outputLatency(): number {
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0)
  }

  /** Song time currently being scheduled (ahead of what the ear hears by outputLatency). */
  time(): number {
    if (!this.anchor) return this.pausedAt
    return songTimeAt(this.anchor, this.smoothCtxTime())
  }

  // The audio clock moves in uneven steps (5–16 ms between screen frames here, bigger
  // in Safari), so the graph would scroll in uneven steps: a judder. This clock runs on
  // the screen's own steady timer and gently follows the audio clock; a seek or a stall
  // (more than 50 ms apart) snaps back to it at once.
  private steady: { ctx: number; perf: number } | null = null
  private smoothCtxTime(): number {
    const c = this.ctx.currentTime
    const p = performance.now() / 1000
    const s = this.steady
    if (!s) {
      this.steady = { ctx: c, perf: p }
      return c
    }
    const predicted = s.ctx + (p - s.perf)
    const err = c - predicted
    const next = Math.abs(err) > 0.05 ? c : predicted + err * 0.06
    this.steady = { ctx: Math.max(next, s.ctx), perf: p } // never backwards
    return this.steady.ctx
  }

  /**
   * How far the listener's ear lags behind the scheduled audio (output buffer +
   * device, incl. Bluetooth), in seconds. Set by the studio from calibration.
   */
  heardLag = 0

  /**
   * Song time the listener is hearing right now. Never earlier than where
   * playback started, so after resuming the playhead waits for the sound
   * instead of jumping back.
   */
  heardTime(): number {
    if (!this.anchor) return this.pausedAt
    return Math.max(this.anchor.songStart, this.time() - this.heardLag * this.speed)
  }

  songTimeAtCtx(ctxTime: number): number {
    if (!this.anchor) return this.pausedAt
    return songTimeAt(this.anchor, ctxTime)
  }

  async setSource(source: AudioSource | null) {
    this.stop()
    this.source = source
    this.variants.clear()
    this.stems = null
    this.pausedAt = 0
    this.duration = source?.duration ?? 0
    this.speed = 1
    this.semitones = 0
    if (source) await this.loadVariant(1, 0)
    this.emit()
  }

  /** Change speed/transpose. Resumes at the same song position. */
  async setVariant(speed: number, semitones: number) {
    if (!this.source) return
    if (!this.source.canSpeed) speed = 1
    if (!this.source.canTranspose) semitones = 0
    if (speed === this.speed && semitones === this.semitones && this.stems) return
    const wasPlaying = this.playing
    const at = this.heardTime()
    this.stop()
    this.pausedAt = at
    await this.loadVariant(speed, semitones)
    if (wasPlaying) this.play()
  }

  private async loadVariant(speed: number, semitones: number) {
    const key = `${speed}|${semitones}`
    let stems = this.variants.get(key)
    if (!stems) {
      this.loadAbort?.abort()
      const ac = new AbortController()
      this.loadAbort = ac
      stems = await this.source!.load(this.ctx, speed, semitones, ac.signal)
      if (ac.signal.aborted) throw new DOMException('aborted', 'AbortError')
      // Decoded audio is big (~10 MB per stem-minute): keep only the current and the previous version.
      if (this.variants.size >= 2) this.variants.delete(this.variants.keys().next().value!)
      this.variants.set(key, stems)
    }
    this.stems = stems
    this.speed = speed
    this.semitones = semitones
    this.emit()
  }

  /**
   * Play a recorded take instead of / alongside the stems. `start` is the song
   * time of the first sample; the recording runs in real time, so at playback
   * speed s it covers song time at s × its duration (same as when it was sung).
   */
  setVoice(v: { buffer: AudioBuffer; start: number } | null) {
    const wasPlaying = this.playing
    if (wasPlaying) this.pause()
    this.voice = v
    if (wasPlaying) void this.play()
  }

  setVolume(stem: 'backing' | 'guide' | 'metronome' | 'voice', v: number) {
    const g = stem === 'backing' ? this.backingGain : stem === 'guide' ? this.guideGain : stem === 'voice' ? this.voiceGain : this.metroGain
    g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
  }

  async play() {
    if (!this.stems || this.playing) return
    if (this.ctx.state !== 'running') await this.ctx.resume()
    if (this.pausedAt >= this.duration - 0.05) this.pausedAt = this.loop?.start ?? 0
    if (this.window && (this.pausedAt >= this.window.end - 0.05 || this.pausedAt < this.window.start)) this.pausedAt = this.window.start
    const startCtx = this.ctx.currentTime + 0.03
    const bufferOffset = this.pausedAt / this.speed
    const start = (buf: AudioBuffer | undefined, gain: GainNode) => {
      if (!buf || bufferOffset >= buf.duration) return
      const n = this.ctx.createBufferSource()
      n.buffer = buf
      n.connect(gain)
      n.start(startCtx, bufferOffset)
      this.nodes.push(n)
    }
    start(this.stems.backing, this.backingGain)
    start(this.stems.guide, this.guideGain)
    if (this.voice) this.startVoice(startCtx, this.pausedAt)
    this.anchor = { ctxStart: startCtx, songStart: this.pausedAt, speed: this.speed }
    this.steady = null
    this.nextBeat = -1
    this.emit()
  }

  /** Start the take so that it lines up with song time `songT` at context time `when`. */
  private startVoice(when: number, songT: number, fadeIn = 0) {
    if (!this.voice) return
    const r = (songT - this.voice.start) / this.speed // seconds into the recording
    if (r >= this.voice.buffer.duration) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.voice.buffer
    const gain = this.ctx.createGain()
    src.connect(gain).connect(this.voiceChain.input)
    if (fadeIn) {
      gain.gain.setValueAtTime(0, when)
      gain.gain.linearRampToValueAtTime(1, when + fadeIn)
    }
    if (r >= 0) src.start(when, r)
    else src.start(when - r, 0)
    this.nodes.push(src)
    this.voiceNode = { src, gain }
  }

  /**
   * Swap in a re-rendered take (new pitch / tune) without stopping anything: the new
   * one starts exactly where playback is, with a 20 ms crossfade.
   */
  replaceVoiceBuffer(buffer: AudioBuffer) {
    if (!this.voice) return
    this.voice = { ...this.voice, buffer }
    if (!this.anchor) return
    const when = this.ctx.currentTime + 0.02
    const old = this.voiceNode
    this.startVoice(when, songTimeAt(this.anchor, when), 0.02)
    if (old) {
      old.gain.gain.setValueAtTime(1, when)
      old.gain.gain.linearRampToValueAtTime(0, when + 0.02)
      try {
        old.src.stop(when + 0.03)
      } catch {
        /* already stopped */
      }
    }
  }

  /** Stop exactly at what the listener heard last — resuming continues from there. */
  pause() {
    if (!this.anchor) return
    this.pausedAt = clampSeek(this.heardTime(), this.duration)
    this.stop()
    this.emit()
  }

  private stop() {
    for (const n of this.nodes) {
      try {
        n.stop()
      } catch {
        /* already stopped */
      }
      n.disconnect()
    }
    this.nodes = []
    this.voiceNode = null
    this.anchor = null
    this.steady = null
  }

  seek(t: number) {
    const wasPlaying = this.playing
    this.onDiscontinuity?.() // while still "playing", so takes end without a results popup
    this.stop()
    if (this.window) t = Math.max(this.window.start, Math.min(t, this.window.end - 0.05))
    this.pausedAt = clampSeek(t, this.duration)
    if (wasPlaying) void this.play()
    this.emit()
  }

  /** Call every animation frame: handles looping, song end and metronome scheduling. */
  tick() {
    if (!this.anchor) return
    const t = this.time()
    const jump = loopJump(t, this.loop)
    if (jump !== null) {
      this.seek(jump)
      return
    }
    if (this.window && this.heardTime() >= this.window.end) {
      this.pausedAt = this.window.end
      this.stop()
      this.emit()
      return
    }
    if (t >= this.duration) {
      this.pausedAt = this.duration
      this.stop()
      this.onDiscontinuity?.()
      this.onEnded?.()
      this.emit()
      return
    }
    if (this.metronome && this.tempo) this.scheduleClicks(t)
  }

  private scheduleClicks(t: number) {
    const beat = 60 / this.tempo!
    const horizon = t + 0.15 * this.speed
    if (this.nextBeat < 0) this.nextBeat = Math.ceil((t - this.firstBeat) / beat)
    while (this.firstBeat + this.nextBeat * beat < horizon) {
      const bt = this.firstBeat + this.nextBeat * beat
      if (bt >= t - 0.01) {
        const when = ctxTimeFor(this.anchor!, bt)
        const accent = ((this.nextBeat % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar === 0
        click(this.ctx, this.metroGain, when, accent)
      }
      this.nextBeat++
    }
  }

  /** The guide-vocal bus (used by the loopback self-test). */
  guideOutput(): AudioNode {
    return this.guideGain
  }

  /** Short click at an exact context time (also used by latency calibration). */
  click(when: number, accent = true) {
    click(this.ctx, this.metroGain, when, accent)
  }

  dispose() {
    this.stop()
    this.loadAbort?.abort()
    this.listeners.clear()
    void this.ctx.close()
  }
}

function click(ctx: BaseAudioContext, out: AudioNode, when: number, accent: boolean) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.frequency.value = accent ? 1600 : 1100
  g.gain.setValueAtTime(0, when)
  g.gain.linearRampToValueAtTime(accent ? 0.9 : 0.55, when + 0.001)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
  o.connect(g).connect(out)
  o.start(when)
  o.stop(when + 0.06)
}

// ---- sources --------------------------------------------------------------

/** A plain local audio file: no stems, no speed/transpose without the analyzer. */
export function fileSource(buffer: AudioBuffer): AudioSource {
  return {
    duration: buffer.duration,
    hasGuide: false,
    canSpeed: false,
    canTranspose: false,
    load: async () => ({ backing: buffer }),
  }
}

/**
 * Stems of an analysed song. `fetchStem` returns the encoded audio for a
 * variant (from this browser's copy or the analyzer, which renders other
 * speeds / keys with Rubber Band).
 */
export function analyzerSource(
  duration: number,
  fetchStem: (stem: 'backing' | 'vocals', speed: number, semis: number, signal: AbortSignal) => Promise<ArrayBuffer>,
): AudioSource {
  return {
    duration,
    hasGuide: true,
    canSpeed: true,
    canTranspose: true,
    load: async (ctx, speed, semis, signal) => {
      const [backing, guide] = await Promise.all(
        (['backing', 'vocals'] as const).map(async (stem) => ctx.decodeAudioData(await fetchStem(stem, speed, semis, signal))),
      )
      return { backing, guide }
    },
  }
}
