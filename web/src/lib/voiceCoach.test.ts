import { describe, expect, it } from 'vitest'
import { CoachState, voiceIssue } from './voiceCoach'
import type { ReferenceNote, UserFrame } from './types'

const notes: ReferenceNote[] = [{ startTime: 0, endTime: 10, midiPitch: 60, confidence: 1, sung: true }]
const frames = (fn: (t: number) => Partial<UserFrame>, from = 0, to = 3): UserFrame[] => {
  const out: UserFrame[] = []
  for (let t = from; t < to; t += 0.01) out.push({ t, midi: 60, clarity: 0.9, level: -25, ...fn(t) })
  return out
}
const at = (f: UserFrame[], floorDb = -70) => voiceIssue({ frames: f, notes, now: 3, floorDb })

describe('voiceIssue', () => {
  it('says nothing when the singer comes through', () => expect(at(frames(() => ({})))).toBeNull())
  it('a few dropouts are fine', () => expect(at(frames((t) => ({ midi: Math.round(t * 100) % 3 === 0 ? null : 60 })))).toBeNull())
  it('nothing heard → silent', () => expect(at(frames(() => ({ midi: null, level: -68 })))).toBe('silent'))
  it('mic overloading → clipping', () => expect(at(frames((t) => ({ level: t > 2 && t < 2.1 ? -1 : -20 })))).toBe('clipping'))
  it('loud room and no clear voice → noisy', () => expect(at(frames(() => ({ midi: null, level: -30 })), -38)).toBe('noisy'))
  it('loud room but the voice still comes through → background noise (told, not ignored)', () =>
    expect(at(frames(() => ({})), -35)).toBe('noise-behind'))
  it('voice barely above a quiet room → quiet', () => expect(at(frames(() => ({ midi: null, level: -62 })), -70)).toBe('quiet'))
  it('loud enough but not pitched → unclear', () => expect(at(frames(() => ({ midi: null, level: -30 })), -70)).toBe('unclear'))
  it('no complaints in an instrumental part', () => {
    const gap: ReferenceNote[] = [{ startTime: 20, endTime: 21, midiPitch: 60, confidence: 1, sung: true }]
    expect(voiceIssue({ frames: frames(() => ({ midi: null, level: -68 })), notes: gap, now: 3, floorDb: -70 })).toBeNull()
  })
})

describe('CoachState (calm messages)', () => {
  it('waits 1.5 s before showing, and keeps a fixed problem up briefly', () => {
    const c = new CoachState()
    expect(c.update('quiet', 0)).toBeNull()
    expect(c.update('quiet', 1)).toBeNull()
    expect(c.update('quiet', 1.6)).toBe('quiet')
    expect(c.update(null, 2)).toBe('quiet') // just fixed: stays a moment
    expect(c.update(null, 4.1)).toBe('quiet') // shown < 3 s ago
    expect(c.update(null, 4.7)).toBeNull()
  })
  it('a single breath never shows anything', () => {
    const c = new CoachState()
    c.update('silent', 0)
    expect(c.update(null, 0.5)).toBeNull()
    expect(c.update(null, 2)).toBeNull()
  })
})
