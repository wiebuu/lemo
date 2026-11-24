// The parts of the course that listen and play: the microphone, the reference tone,
// and the trainer that walks through a line note by note.

import { MicError, MicInput, type MicReading } from '../audio/mic'
import { foldOctave, midiToFreq } from '../lib/music'
import { defaultNotation, type Notation } from './course'

/** In tune = within this many cents of the note. */
export const IN_TUNE = 30

// ---------------------------------------------------------------- what's kept

export interface Progress {
  notation: Notation
  /** home note (Sa / Do / 1) as a MIDI note */
  home: number
  /** done the "find your voice" step */
  voiceSet: boolean
  /** best test result per lesson */
  best: Record<string, { acc: number; stars: number }>
  free: { line: string; hold: number; autoplay: boolean }
}

const KEY = 'lemody.course'
export function loadProgress(): Progress {
  const base: Progress = { notation: defaultNotation(), home: 48, voiceSet: false, best: {}, free: { line: '', hold: 1, autoplay: true } }
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return base
  }
}
export const saveProgress = (p: Progress) => localStorage.setItem(KEY, JSON.stringify(p))

// ---------------------------------------------------------------- mic + speaker

/** One audio context, the mic, and the reference tone. The mic ignores the tone while it sounds. */
export class VoiceIO {
  private ctx: AudioContext | null = null
  private mic: MicInput | null = null
  onReading: ((r: MicReading, quiet: boolean) => void) | null = null
  private quietUntil = 0
  on = false

  audio() {
    this.ctx ??= new AudioContext({ latencyHint: 'interactive' })
    void this.ctx.resume()
    return this.ctx
  }

  /** Starts listening; throws a readable message if the mic can't be used. */
  async start() {
    if (this.mic) return
    const mic = new MicInput()
    mic.onReading = (r) => this.onReading?.(r, performance.now() / 1000 < this.quietUntil)
    try {
      await mic.start(this.audio())
    } catch (e) {
      throw new Error(e instanceof MicError ? e.message : 'Could not start the microphone.')
    }
    this.mic = mic
    this.on = true
  }

  stop() {
    this.mic?.stop()
    this.mic = null
    this.on = false
  }

  close() {
    this.stop()
    void this.ctx?.close()
    this.ctx = null
  }

  /** A soft, warm tone (a few harmonics, gentle attack) — easier to match than a bare sine. */
  play(midi: number, seconds = 0.9) {
    const ctx = this.audio()
    const t = ctx.currentTime + 0.02
    const real = new Float32Array([0, 1, 0.45, 0.25, 0.12, 0.06, 0.03])
    const osc = ctx.createOscillator()
    osc.setPeriodicWave(ctx.createPeriodicWave(real, new Float32Array(real.length)))
    osc.frequency.value = midiToFreq(midi)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.22, t + 0.04)
    g.gain.setValueAtTime(0.22, t + seconds - 0.25)
    g.gain.linearRampToValueAtTime(0, t + seconds)
    osc.connect(g).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + seconds + 0.05)
    this.quietUntil = performance.now() / 1000 + seconds + 0.2
  }

  /** A few notes one after another (to hear a whole line). */
  playLine(midis: number[], each = 0.55) {
    midis.forEach((m, i) => setTimeout(() => this.play(m, each), i * each * 1000))
  }
}

// ---------------------------------------------------------------- the trainer

export interface NoteResult {
  /** average distance from the note while it counted, cents */
  off: number
  /** seconds from the note lighting up to finishing it */
  took: number
  skipped: boolean
}

/** Walks through a line: hold the current note in tune long enough and it moves on. */
export class Trainer {
  notes: number[] = []
  idx = 0
  /** seconds held in tune on the current note */
  held = 0
  results: NoteResult[] = []
  /** cents from the current note (any octave), or null when not singing */
  cents: number | null = null
  /** what you're singing, as a MIDI note */
  sung: number | null = null
  hints = 0
  startedAt = 0
  finishedAt = 0
  private noteStartedAt = 0
  private offSum = 0
  private offN = 0
  private last = 0

  load(notes: number[]) {
    this.notes = notes
    this.idx = 0
    this.held = 0
    this.results = []
    this.cents = this.sung = null
    this.hints = 0
    this.startedAt = this.finishedAt = this.noteStartedAt = 0
    this.offSum = this.offN = 0
    this.last = 0
  }

  get done() {
    return this.notes.length > 0 && this.idx >= this.notes.length
  }

  get current(): number | undefined {
    return this.notes[this.idx]
  }

  /** Feed one mic reading. Returns true when a note was just finished. */
  push(r: MicReading, home: number, hold: number, quiet: boolean): boolean {
    const now = performance.now() / 1000
    const dt = this.last ? Math.min(0.1, now - this.last) : 0
    this.last = now
    if (this.done) return false
    if (quiet || r.midi === null) {
      this.cents = this.sung = null
      // not singing: a held note fades only slowly, so a quick breath doesn't undo it
      if (!quiet) this.held = Math.max(0, this.held - dt * 0.5)
      return false
    }
    if (!this.startedAt) this.startedAt = this.noteStartedAt = now
    this.sung = r.midi
    // any octave counts: a low voice singing a high note (or the other way) is still that note
    this.cents = foldOctave((r.midi - (home + this.notes[this.idx])) * 100).folded
    if (Math.abs(this.cents) <= IN_TUNE) {
      this.held += dt
      this.offSum += Math.abs(this.cents)
      this.offN++
    } else {
      this.held = Math.max(0, this.held - dt * 1.5)
    }
    if (this.held < hold) return false
    this.finish(false, now)
    return true
  }

  /** Give up on this note (it counts as missed). Returns true when that was the last one. */
  skip(): boolean {
    if (this.done) return false
    const now = performance.now() / 1000
    if (!this.startedAt) this.startedAt = this.noteStartedAt = now
    this.finish(true, now)
    return this.done
  }

  private finish(skipped: boolean, now: number) {
    this.results.push({ off: this.offN ? this.offSum / this.offN : 0, took: now - this.noteStartedAt, skipped })
    this.idx++
    this.held = 0
    this.offSum = this.offN = 0
    this.noteStartedAt = now
    this.cents = this.sung = null
    if (this.done) this.finishedAt = now
  }

  /** 0–100: how close you were (0 cents off = 100, 30 off = 70; a skipped note = 0) */
  get accuracy() {
    if (!this.results.length) return 0
    return Math.round(this.results.reduce((a, r) => a + (r.skipped ? 0 : 100 - r.off), 0) / this.results.length)
  }

  /** average seconds to land a note */
  get findTime() {
    const r = this.results.filter((x) => !x.skipped)
    return r.length ? r.reduce((a, x) => a + x.took, 0) / r.length : 0
  }

  get seconds() {
    if (!this.startedAt) return 0
    return (this.finishedAt || performance.now() / 1000) - this.startedAt
  }

  get skipped() {
    return this.results.filter((r) => r.skipped).length
  }
}
