// Demo song "Kettle Morning" — melody, chords and lyrics written for lemo.
// Everything is synthesised in the browser, so the reference melody is exact
// and speed/transpose are rendered perfectly (no time-stretch artifacts).

import { lyricsFromNotes } from '../lib/phrases'
import { midiToFreq } from '../lib/music'
import type { HarmonySegment, ReferenceNote, ReferenceTrack } from '../lib/types'
import type { AudioSource, StemSet } from './engine'

const BPM = 84
const INTRO_BEATS = 8
const LINE_BEATS = 8

// [syllable, midi, beats]
type N = [string, number, number]
const LINES: N[][] = [
  [['mor', 64, 1], ['ning ', 62, 0.5], ['light ', 60, 1.5], ['on ', 62, 0.5], ['the ', 64, 0.5], ['win', 67, 1.5], ['dow', 64, 1.5]],
  [['hum', 65, 1], ['ming ', 64, 0.5], ['low, ', 62, 1.5], ['the ', 60, 0.5], ['ket', 62, 0.5], ['tle ', 64, 1], ['sings', 62, 2]],
  [['ev', 64, 0.5], ['ery ', 67, 0.5], ['note ', 69, 1.5], ['a ', 67, 0.5], ['lit', 64, 0.5], ['tle ', 67, 1], ['clo', 69, 1], ['ser', 67, 1.5]],
  [['find ', 65, 1], ['the ', 64, 0.5], ['line ', 62, 1.5], ['and ', 64, 0.5], ['let ', 62, 0.5], ['it ', 59, 1], ['ring', 60, 2]],
]

// Intended dynamics per line in dB (soft → building → strong → gentle).
// The guide vocal is rendered at exactly these levels, so they're true reference data.
const LINE_DB = [-6, 0, 6, -2]

// [startBeat, lengthBeats, chord tones (first = root)]
const CHORDS: [number, number, number[]][] = [
  [0, 4, [48, 60, 64, 67]], [4, 4, [43, 59, 62, 67]],
  [8, 4, [48, 60, 64, 67]], [12, 4, [45, 57, 60, 64]],
  [16, 4, [41, 57, 60, 65]], [20, 4, [43, 59, 62, 67]],
  [24, 4, [48, 60, 64, 67]], [28, 4, [45, 57, 60, 64]],
  [32, 4, [41, 57, 60, 65]], [36, 4, [43, 59, 62, 67]],
  [40, 4, [48, 55, 60, 64]],
]
const TOTAL_BEATS = 46

function demoNotes(beatSec: number): ReferenceNote[] {
  const notes: ReferenceNote[] = []
  LINES.forEach((line, li) => {
    let beat = INTRO_BEATS + li * LINE_BEATS
    for (const [lyric, midi, len] of line) {
      notes.push({
        startTime: beat * beatSec,
        endTime: (beat + len) * beatSec - 0.04,
        midiPitch: midi,
        confidence: 1,
        sung: true,
        lyric,
        line: li,
        loudness: LINE_DB[li],
      })
      beat += len
    }
  })
  return notes
}

export function demoTrack(): ReferenceTrack {
  const beatSec = 60 / BPM
  const notes = demoNotes(beatSec)
  return {
    id: 'demo-kettle-morning',
    title: 'Kettle Morning',
    artist: 'Lemody demo',
    duration: TOTAL_BEATS * beatSec,
    notes,
    lyrics: lyricsFromNotes(notes),
    lyricsTiming: 'word',
    sourceType: 'demo',
    analysisStatus: 'ready',
    melodySource: 'demo (exact, written for lemo)',
    harmony: CHORDS.map(([start, len, tones]): HarmonySegment => ({
      start: start * beatSec,
      end: (start + len) * beatSec,
      pcs: [...new Set(tones.map((m) => m % 12))],
      confidence: 1,
    })),
    harmonySource: 'exact',
    tempo: BPM,
    firstBeat: 0,
    beatsPerBar: 4,
    warnings: [],
  }
}

export const demoSource: AudioSource = {
  duration: TOTAL_BEATS * (60 / BPM),
  hasGuide: true,
  canSpeed: true,
  canTranspose: true,
  load: (_ctx, speed, semis) => renderDemo(speed, semis),
}

async function renderDemo(speed: number, semis: number): Promise<StemSet> {
  const sr = 44100
  const beat = 60 / (BPM * speed)
  const len = Math.ceil((TOTAL_BEATS * beat + 1) * sr)
  const f = (m: number) => midiToFreq(m + semis)

  // Backing
  const bctx = new OfflineAudioContext(2, len, sr)
  const master = bctx.createGain()
  master.gain.value = 0.8
  master.connect(bctx.destination)
  const noiseBuf = bctx.createBuffer(1, sr * 0.1, sr)
  const nd = noiseBuf.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

  for (const [start, length, tones] of CHORDS) {
    const t0 = start * beat
    const t1 = (start + length) * beat
    // pad
    const lp = bctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1400
    const pg = bctx.createGain()
    pg.gain.setValueAtTime(0, t0)
    pg.gain.linearRampToValueAtTime(0.045, t0 + 0.25)
    pg.gain.setValueAtTime(0.045, t1 - 0.15)
    pg.gain.linearRampToValueAtTime(0, t1 + 0.2)
    lp.connect(pg).connect(master)
    for (const m of tones.slice(1)) {
      for (const det of [-6, 6]) {
        const o = bctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = f(m)
        o.detune.value = det
        o.connect(lp)
        o.start(t0)
        o.stop(t1 + 0.25)
      }
    }
    // bass on beats 1, 3 and the "and" of 4
    for (const b of [0, 2, 3.5]) {
      if (b >= length) continue
      const bt = t0 + b * beat
      const o = bctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = f(tones[0] - 12)
      const g = bctx.createGain()
      g.gain.setValueAtTime(0.0001, bt)
      g.gain.exponentialRampToValueAtTime(0.32, bt + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, bt + beat * 1.4)
      o.connect(g).connect(master)
      o.start(bt)
      o.stop(bt + beat * 1.5)
    }
  }
  // drums
  for (let b = 0; b < TOTAL_BEATS - 2; b++) {
    const bt = b * beat
    if (b % 2 === 0) {
      const o = bctx.createOscillator()
      o.frequency.setValueAtTime(130, bt)
      o.frequency.exponentialRampToValueAtTime(42, bt + 0.18)
      const g = bctx.createGain()
      g.gain.setValueAtTime(0.55, bt)
      g.gain.exponentialRampToValueAtTime(0.0001, bt + 0.3)
      o.connect(g).connect(master)
      o.start(bt)
      o.stop(bt + 0.32)
    }
    for (const half of [0, 0.5]) {
      const ht = bt + half * beat
      const s = bctx.createBufferSource()
      s.buffer = noiseBuf
      const hp = bctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 7000
      const g = bctx.createGain()
      g.gain.setValueAtTime(half ? 0.035 : 0.06, ht)
      g.gain.exponentialRampToValueAtTime(0.0001, ht + 0.05)
      s.connect(hp).connect(g).connect(master)
      s.start(ht)
      s.stop(ht + 0.06)
    }
  }

  // Guide melody: soft "ooh" tone with gentle vibrato.
  const gctx = new OfflineAudioContext(1, len, sr)
  const gm = gctx.createGain()
  gm.gain.value = 0.9
  gm.connect(gctx.destination)
  for (const n of demoNotes(beat)) {
    const t0 = n.startTime
    const t1 = n.endTime
    const amp = 0.2 * Math.pow(10, (n.loudness ?? 0) / 20)
    const g = gctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(amp, t0 + 0.035)
    g.gain.setValueAtTime(amp, Math.max(t0 + 0.04, t1 - 0.06))
    g.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.04)
    g.connect(gm)
    const lfo = gctx.createOscillator()
    lfo.frequency.value = 5.5
    const lfoGain = gctx.createGain()
    lfoGain.gain.setValueAtTime(0, t0)
    lfoGain.gain.linearRampToValueAtTime(t1 - t0 > 0.5 ? 18 : 0, Math.min(t1, t0 + 0.45))
    lfo.connect(lfoGain)
    for (const [h, amp] of [[1, 1], [2, 0.28], [3, 0.1]] as const) {
      const o = gctx.createOscillator()
      o.frequency.value = f(n.midiPitch) * h
      lfoGain.connect(o.detune)
      const hg = gctx.createGain()
      hg.gain.value = amp
      o.connect(hg).connect(g)
      o.start(t0)
      o.stop(t1 + 0.06)
    }
    lfo.start(t0)
    lfo.stop(t1 + 0.06)
  }

  const [backing, guide] = await Promise.all([bctx.startRendering(), gctx.startRendering()])
  return { backing, guide }
}
