// While a test runs: is the mic hearing the singer well? Looks at the last couple of
// seconds — only where the original is singing (no complaints in instrumental parts) —
// and names the most likely problem, so the singer can fix it without stopping.

import type { ReferenceNote, UserFrame } from './types'

export type VoiceIssue = 'muted' | 'clipping' | 'silent' | 'noisy' | 'noise-behind' | 'quiet' | 'unclear'

export const ISSUE_TEXT: Record<VoiceIssue, { title: string; hint: string }> = {
  muted: { title: 'Your mic is muted', hint: 'Tap the mic button to unmute. Nothing you sing is counted while it’s muted.' },
  clipping: { title: 'Too loud', hint: 'The mic is overloading. Move back a little or sing softer.' },
  silent: { title: "Can't hear you", hint: "Sing up, or check your mic isn't muted or covered." },
  noisy: { title: 'Too much background noise', hint: 'It drowns out your voice. Try a quieter spot, or move the mic closer to your mouth.' },
  'noise-behind': { title: 'Background noise', hint: 'There’s a lot of noise behind you (fan, traffic, people, music). It can throw off your score — a quieter spot helps.' },
  quiet: { title: 'Your voice is too quiet', hint: 'Sing a bit louder or bring the mic closer.' },
  unclear: { title: "Your voice isn't coming through clearly", hint: 'Sing the notes out, a little less breathy.' },
}

export interface CoachInput {
  frames: UserFrame[]
  notes: ReferenceNote[]
  /** now, in song time */
  now: number
  /** quiet-room level (dB): 20th percentile of the mic's level when not singing */
  floorDb: number | null
  window?: number
}

/** The most likely problem right now, or null when the mic hears the singer fine. */
export function voiceIssue({ frames, notes, now, floorDb, window = 2 }: CoachInput): VoiceIssue | null {
  const from = now - window
  const recent = frames.filter((f) => f.t >= from && f.t <= now && f.level !== undefined)
  if (recent.length < 40) return null
  const inNote = (t: number) => notes.some((n) => n.sung && n.startTime <= t && n.endTime >= t)
  const sung = recent.filter((f) => inNote(f.t))
  if (sung.length < recent.length * 0.6) return null // mostly instrumental: nothing to judge

  const levels = sung.map((f) => f.level!).sort((a, b) => a - b)
  const median = levels[levels.length >> 1]
  const loudFrames = sung.filter((f) => f.level! > -4).length
  const voiced = sung.filter((f) => f.midi !== null).length / sung.length
  const floor = floorDb ?? -70

  if (loudFrames >= 5) return 'clipping'
  // the room itself is loud: say so even when the voice still comes through
  if (floor > -40) return voiced >= 0.5 ? 'noise-behind' : 'noisy'
  if (voiced >= 0.5) return null // heard well enough
  if (voiced < 0.15 && median < floor + 6) return 'silent'
  if (floor > -45) return 'noisy'
  if (median - floor < 12) return 'quiet'
  return 'unclear'
}

/**
 * Keeps the message calm: a problem must last ~1.5 s before it shows, stays at least
 * 3 s once shown, and goes 2 s after it's fixed — no flicker over a breath.
 */
export class CoachState {
  private candidate: VoiceIssue | null = null
  private since = 0
  private shownAt = 0
  private okSince = 0
  shown: VoiceIssue | null = null

  update(issue: VoiceIssue | null, at: number): VoiceIssue | null {
    if (issue !== this.candidate) {
      this.candidate = issue
      this.since = at
    }
    if (issue && at - this.since >= 1.5 && issue !== this.shown) {
      this.shown = issue
      this.shownAt = at
    }
    if (!issue) {
      if (!this.okSince) this.okSince = at
    } else this.okSince = 0
    if (this.shown && !issue && at - this.okSince >= 2 && at - this.shownAt >= 3) this.shown = null
    return this.shown
  }

  reset() {
    this.candidate = null
    this.shown = null
    this.since = this.shownAt = this.okSince = 0
  }
}
