// Pure pitch math. No assumptions about the song's key or tuning:
// comparisons always use the actual reference frequency/MIDI value.

export const A4_HZ = 440
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** midi = 69 + 12 * log2(f / 440). Returns a fractional MIDI number. */
export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / A4_HZ)
}

export function midiToFreq(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - 69) / 12)
}

/** cents = 1200 * log2(detected / target). Positive = sharp. */
export function centsBetween(detectedHz: number, targetHz: number): number {
  return 1200 * Math.log2(detectedHz / targetHz)
}

/** Same as centsBetween, but for fractional MIDI values. */
export function centsBetweenMidi(detected: number, target: number): number {
  return (detected - target) * 100
}

/** "A4", "C#3" … for the nearest semitone. */
export function midiToNoteName(midi: number): string {
  const n = Math.round(midi)
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1)
}

export function isNatural(midi: number): boolean {
  return !NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12].includes('#')
}

/**
 * Fold a cents deviation into the nearest octave. Returns the folded deviation
 * (-600..600) and how many octaves were removed (0 = same octave).
 */
export function foldOctave(cents: number): { folded: number; octaves: number } {
  const octaves = Math.round(cents / 1200)
  return { folded: cents - octaves * 1200, octaves }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
