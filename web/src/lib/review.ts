// After a test: how wrong was each note, for the aspect the singer wants to look at.
// Severity 0 = fine, 1 = as wrong as it gets. The difficulty (tolerance) sets the
// scale, so the same mistake looks redder on "strict" than on "easy".

import { median } from './music'
import type { Evaluation } from './evaluation'
import type { ReferenceNote } from './types'

export type ReviewAspect = 'pitch' | 'key' | 'tone' | 'attack' | 'timing' | 'steadiness' | 'loudness'

export interface NoteReview {
  noteIndex: number
  /** 0..1, or null when this aspect doesn't apply to the note. */
  severity: number | null
  missed: boolean
  /** Short plain-language description, e.g. "a little sharp". */
  label: string
  /** Signed value behind the label (cents, ms, dB) — for sorting / tests. */
  value: number | null
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** 1 at "normal" difficulty (±50¢), 2 on easy, 0.5 on strict. */
export const strictness = (toleranceCents: number) => toleranceCents / 50

export function reviewNotes(ev: Evaluation, notes: ReferenceNote[], aspect: ReviewAspect, toleranceCents: number, exact: boolean): NoteReview[] {
  const f = strictness(toleranceCents)
  // dynamics needs the singer's own median level as reference
  const levels = ev.notes.filter((n) => n.sung && n.levelDb !== null).map((n) => n.levelDb!)
  const refLoud = ev.notes.map((n) => notes[n.noteIndex]?.loudness).filter((v): v is number => v !== undefined)
  const userMed = levels.length ? median(levels) : 0
  const refMed = refLoud.length ? median(refLoud) : 0

  return ev.notes.map((n) => {
    const base = { noteIndex: n.noteIndex, missed: !n.sung }
    if (!n.sung) return { ...base, severity: aspect === 'pitch' ? 0.5 : null, label: 'not sung', value: null }
    switch (aspect) {
      case 'pitch': {
        let c = exact ? n.absCents : n.relCents
        if (c === null) return { ...base, severity: null, label: '', value: null }
        if (exact && Math.abs(c) > 600) return { ...base, severity: 1, label: 'wrong octave', value: c }
        const off = Math.max(0, Math.abs(c) - toleranceCents)
        const sev = clamp01(off / (150 * f))
        const words = Math.abs(c) < toleranceCents ? 'on the note' : Math.abs(c) < 100 ? (c > 0 ? 'a little sharp' : 'a little flat') : c > 0 ? 'sharp' : 'flat'
        return { ...base, severity: sev, label: words, value: c }
      }
      case 'key': {
        // Against the music itself (not your own key): an octave off is fine, anything else clashes.
        if (n.absCents === null) return { ...base, severity: null, label: '', value: null }
        const d = Math.abs(n.absCents - 1200 * Math.round(n.absCents / 1200))
        const sev = n.clash ? 1 : clamp01((d - toleranceCents) / (150 * f))
        const words = n.clash ? 'clashes with the chord' : d <= toleranceCents ? 'fits the music' : d < 150 ? 'a little off the music' : `${Math.round(d / 100)} keys off the music`
        return { ...base, severity: sev, label: words, value: d }
      }
      case 'tone': {
        if (!n.tone) return { ...base, severity: null, label: '', value: null }
        const q = 0.6 * clamp01((n.tone.clarity - 0.78) / (0.94 - 0.78)) + 0.4 * clamp01(1 - n.tone.noisy / 0.35)
        const sev = clamp01((1 - q - 0.1) / 0.8)
        return { ...base, severity: sev, label: q > 0.85 ? 'clean' : q > 0.55 ? 'a bit breathy' : 'breathy / rough', value: n.tone.clarity }
      }
      case 'attack': {
        if (!n.attack) return { ...base, severity: null, label: '', value: null }
        const ms = n.attack.settleMs
        const q = (ms === null ? 0 : clamp01(1 - (ms - 60) / 200)) * (n.attack.scoop ? 0.7 : 1)
        const label = ms === null ? 'never landed on the note' : n.attack.scoop ? 'scooped up into it' : ms <= 60 ? 'clean start' : `${Math.round(ms)} ms to land`
        return { ...base, severity: clamp01(1 - q), label, value: ms }
      }
      case 'timing': {
        if (n.onsetMs === null) return { ...base, severity: null, label: '', value: null }
        const ms = n.onsetMs
        const thr = 80 * f
        const sev = clamp01((Math.abs(ms) - thr) / (300 * f))
        const words = Math.abs(ms) <= thr ? 'on time' : `${Math.round(Math.abs(ms))} ms ${ms > 0 ? 'late' : 'early'}`
        return { ...base, severity: sev, label: words, value: ms }
      }
      case 'steadiness': {
        const st = n.stability
        if (!st) return { ...base, severity: null, label: '', value: null }
        const sev = clamp01((1 - st.score) / Math.max(0.3, f * 0.6))
        const words = st.kind === 'unstable' ? 'wavering' : st.kind === 'wobble' ? 'very wide vibrato' : st.kind === 'vibrato' ? 'steady, with vibrato' : 'steady'
        return { ...base, severity: st.kind === 'steady' || st.kind === 'vibrato' ? Math.min(sev, 0.15) : sev, label: words, value: st.jitterCents }
      }
      case 'loudness': {
        const ref = notes[n.noteIndex]?.loudness
        if (n.levelDb === null || ref === undefined || !levels.length) return { ...base, severity: null, label: '', value: null }
        const d = n.levelDb - userMed - (ref - refMed)
        const sev = clamp01((Math.abs(d) - 3 * f) / (9 * f))
        const words = Math.abs(d) <= 3 * f ? 'matches the original' : d > 0 ? 'too strong here' : 'too soft here'
        return { ...base, severity: sev, label: words, value: d }
      }
    }
  })
}

/** Which aspects have anything to show for this result. */
export function availableAspects(ev: Evaluation, notes: ReferenceNote[]): ReviewAspect[] {
  const out: ReviewAspect[] = ['pitch']
  if (ev.notes.some((n) => n.sung && n.absCents !== null)) out.push('key')
  if (ev.notes.some((n) => n.sung && n.tone)) out.push('tone')
  if (ev.notes.some((n) => n.sung && n.attack)) out.push('attack')
  if (ev.notes.some((n) => n.sung && n.onsetMs !== null)) out.push('timing')
  if (ev.notes.some((n) => n.sung && n.stability)) out.push('steadiness')
  if (ev.notes.some((n) => n.sung && n.levelDb !== null && notes[n.noteIndex]?.loudness !== undefined)) out.push('loudness')
  return out
}
