// The effects your voice goes through when you listen back to a take: tone (a tilt
// EQ), echo and reverb — live audio nodes, so every change is heard instantly.
// (Pitch and "tune" re-render the take itself: lib/voiceFx.ts.)

import type { VoiceFx } from '../lib/voiceFx'

export class VoiceChain {
  readonly input: GainNode
  private low: BiquadFilterNode
  private high: BiquadFilterNode
  private echoSend: GainNode
  private echoDelay: DelayNode
  private echoFeedback: GainNode
  private reverbSend: GainNode
  private reverb: ConvolverNode
  private ctx: BaseAudioContext

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.low = ctx.createBiquadFilter()
    this.low.type = 'lowshelf'
    this.low.frequency.value = 250
    this.high = ctx.createBiquadFilter()
    this.high.type = 'highshelf'
    this.high.frequency.value = 3000
    this.input.connect(this.low).connect(this.high)
    this.high.connect(out) // dry

    // echo: a quarter-ish second, a few repeats
    this.echoSend = ctx.createGain()
    this.echoDelay = ctx.createDelay(1)
    this.echoDelay.delayTime.value = 0.27
    this.echoFeedback = ctx.createGain()
    const echoTone = ctx.createBiquadFilter() // each repeat a little darker, like a real echo
    echoTone.type = 'lowpass'
    echoTone.frequency.value = 3500
    this.high.connect(this.echoSend).connect(this.echoDelay).connect(echoTone)
    echoTone.connect(this.echoFeedback).connect(this.echoDelay)
    echoTone.connect(out)

    // reverb: a generated room (decaying noise), no files to load
    this.reverbSend = ctx.createGain()
    this.reverb = ctx.createConvolver()
    this.reverb.buffer = room(ctx, 2.2)
    this.high.connect(this.reverbSend).connect(this.reverb).connect(out)
    this.set({ echo: 0, reverb: 0, tone: 0 })
  }

  set(fx: Pick<VoiceFx, 'echo' | 'reverb' | 'tone'>) {
    const t = this.ctx.currentTime
    const glide = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.03)
    glide(this.echoSend.gain, fx.echo * 0.6)
    glide(this.echoFeedback.gain, fx.echo * 0.45)
    glide(this.reverbSend.gain, fx.reverb * 0.9)
    // tone: warm = more low end, less top; bright = the other way round
    glide(this.low.gain, -fx.tone * 6)
    glide(this.high.gain, fx.tone * 8)
  }
}

/** Stereo impulse response of a room: decaying noise with a soft start. */
function room(ctx: BaseAudioContext, secs: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * secs)
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < n; i++) {
      const tt = i / ctx.sampleRate
      d[i] = rand() * Math.exp(-tt * 3.2) * Math.min(1, tt / 0.01) * 0.6
    }
  }
  return buf
}
