// Shared data contracts between modules (and with the Python analyzer).

export interface ReferenceNote {
  startTime: number
  endTime: number
  /** Fractional MIDI pitch, so non-A440 tuning is preserved. */
  midiPitch: number
  /** 0..1 — how sure the source is about this note. Charts use 1. */
  confidence: number
  /** false = freestyle / spoken / not meant to be pitch-scored. */
  sung: boolean
  lyric?: string
  /** Phrase/line index when the source provides one. */
  line?: number
  /** Reference vocal loudness for this note in dB, relative to the track's typical vocal level. */
  loudness?: number
  /** Detected as voice, but well away from any lyric line — probably not the lead singer. Hidden and not scored. */
  offLyrics?: boolean
}

/** Dense pitch contour sampled every `hop` seconds; null = unvoiced. */
export interface PitchContour {
  t0: number
  hop: number
  midi: (number | null)[]
}

/** Reference vocal loudness envelope, dB relative to the track's typical vocal level. */
export interface LoudnessEnvelope {
  t0: number
  hop: number
  db: (number | null)[]
}

/** Accompaniment chord, as pitch classes (0 = C). Only stored when reliable. */
export interface HarmonySegment {
  start: number
  end: number
  pcs: number[]
  confidence: number
}

export interface LyricWord {
  start: number
  end: number
  text: string
}

export interface LyricLine {
  id: string
  /** null = timing unknown. We never invent timestamps. */
  start: number | null
  end: number | null
  text: string
  words?: LyricWord[]
  /** true once a human confirmed the timing (manual edit / chart). */
  verified: boolean
  /** Where per-word timing came from: a chart, forced alignment to the vocal, or an estimate from note starts. */
  wordsSource?: 'chart' | 'aligned' | 'estimated'
}

export type SourceType = 'demo' | 'upload' | 'youtube' | 'ultrastar' | 'midi'
export type AnalysisStatus = 'ready' | 'partial' | 'failed'

export interface ReferenceTrack {
  id: string
  title: string
  artist?: string
  duration: number
  notes: ReferenceNote[]
  contour?: PitchContour
  lyrics: LyricLine[]
  lyricsTiming: 'word' | 'line' | 'none'
  sourceType: SourceType
  analysisStatus: AnalysisStatus
  /** Where the melody came from, e.g. "demucs+crepe", "ultrastar chart". */
  melodySource: string
  /** One of the server's featured songs (kept there; not copied into the browser). */
  featured?: boolean
  loudness?: LoudnessEnvelope
  harmony?: HarmonySegment[]
  /** 'exact' (demo, known chords) or 'estimated' (chroma analysis of the backing). */
  harmonySource?: 'exact' | 'estimated'
  /** Time spans where the lyrics say someone is singing (set when the lyric gate is active). */
  voiceSpans?: [number, number][]
  tempo?: number
  firstBeat?: number
  beatsPerBar?: number
  warnings: string[]
}

export interface BreathMark {
  id: string
  time: number
  kind: 'manual' | 'suggested'
}

export interface Phrase {
  index: number
  start: number
  end: number
}

/** One analysed microphone frame, already mapped to song time. */
export interface UserFrame {
  t: number
  /** null when no confident voice was detected. */
  midi: number | null
  clarity: number
  /** Microphone level in dBFS (RMS of the analysis window). Relative use only. */
  level?: number
}

export type NoteStatus = 'hit' | 'sharp' | 'flat' | 'octave' | 'missed'

export interface NoteResult {
  noteIndex: number
  status: NoteStatus
  /** Median deviation in cents (octave-folded for octave errors). */
  cents: number | null
  coverage: number
  onPitchRatio: number
  /** Seconds the user started late (+) or early (−); null if unknown. */
  onsetDelta: number | null
}

export interface ScoreSummary {
  from: number
  to: number
  notesTotal: number
  hit: number
  sharp: number
  flat: number
  octave: number
  missed: number
  /** On-pitch frames ÷ all frames inside target notes (silence lowers it). */
  accuracy: number
  /** On-pitch frames ÷ voiced frames — "when you sang, how in tune". null if never sang. */
  pitchAccuracy: number | null
  /** Voiced frames ÷ expected frames. */
  coverage: number
  medianAbsCents: number | null
  medianOnsetMs: number | null
  notes: NoteResult[]
}

export type MetricKey = 'shape' | 'harmony' | 'tone' | 'attack' | 'dynamics' | 'rhythm' | 'stability' | 'exact'

export interface Attempt {
  id: string
  at: number
  phrase: number | null
  /** Per-metric scores 0..1 (null = not measurable this take) + the weighted overall. */
  scores: Record<MetricKey, number | null> & { overall: number | null }
  keyOffset: number | null
}
