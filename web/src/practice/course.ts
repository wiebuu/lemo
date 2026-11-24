// The singing course: how notes are written (Sa Re Ga, Do Re Mi, C D E, 1 2 3) and the
// lessons, one new note at a time — the way a typing course adds one key at a time.
// Everything is in semitones above your home note (Sa / Do / 1), so any voice fits.

import { midiToNoteName } from '../lib/music'

export type Notation = 'sargam' | 'solfege' | 'letters' | 'numbers'

export const NOTATIONS: { id: Notation; label: string; tip: string }[] = [
  { id: 'solfege', label: 'Do Re Mi', tip: 'Solfège — how most of the world learns to sing' },
  { id: 'sargam', label: 'Sa Re Ga', tip: 'Sargam — Indian classical' },
  { id: 'letters', label: 'C D E', tip: 'Note names — as on a piano' },
  { id: 'numbers', label: '1 2 3', tip: 'Numbers — the steps of the scale' },
]

/** India (and nearby) learns with Sa Re Ga; everyone else gets Do Re Mi first. */
export function defaultNotation(): Notation {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  return langs.some((l) => /-(IN|NP|PK|BD|LK)$/i.test(l) || /^(hi|bn|mr|ta|te|kn|ml|gu|pa|ne|ur)\b/i.test(l)) ? 'sargam' : 'solfege'
}

/** The major scale, in semitones above home: the 8 notes the course climbs. */
export const SCALE = [0, 2, 4, 5, 7, 9, 11, 12]

const NAMES: Record<Exclude<Notation, 'letters'>, string[]> = {
  sargam: ['Sa', 'Re', 'Ga', 'Ma', 'Pa', 'Dha', 'Ni'],
  solfege: ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'],
  numbers: ['1', '2', '3', '4', '5', '6', '7'],
}

export interface Label {
  text: string
  /** -1 the octave below home, 0, 1 the octave above (drawn as a dot below / above, as written) */
  oct: number
}

/** How a note (semitones above home) is written in this notation. */
export function label(semis: number, notation: Notation, home: number): Label {
  const oct = Math.floor(semis / 12)
  const within = semis - oct * 12
  if (notation === 'letters') return { text: midiToNoteName(home + semis).replace(/-?\d+$/, ''), oct }
  const deg = SCALE.indexOf(within)
  // off the scale (only possible in free practice): fall back to its letter name
  if (deg < 0) return { text: midiToNoteName(home + semis).replace(/-?\d+$/, ''), oct }
  return { text: NAMES[notation][deg], oct }
}

/** The home note's name, for sentences ("Sa", "Do", "1", "D"). */
export const homeName = (notation: Notation, home: number) => label(0, notation, home).text

// ---------------------------------------------------------------- reading a typed line

const WORDS: Record<string, number> = {
  sa: 0, re: 2, ri: 2, ga: 4, ma: 5, pa: 7, dha: 9, dh: 9, da: 9, ni: 11,
  do: 0, mi: 4, fa: 5, so: 7, sol: 7, la: 9, ti: 11, si: 11,
}
const LETTERS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

/**
 * "do re mi do'" / "sa re ga" / "1 2 3 8" / "c d e" → semitones above home.
 * A ' after a note is the one above, a , after it (or . before) the one below.
 * Letters are real note names, placed in the octave from home upward.
 */
export function parseLine(text: string, home: number): number[] {
  const out: number[] = []
  for (const raw of text.toLowerCase().split(/[\s|/–—-]+/)) {
    const m = /^(\.?)([a-z]+|[1-8])([#♯♭]?)(['’]?)(,?)$/.exec(raw)
    if (!m) continue
    const [, dotBefore, word, acc, up, down] = m
    let s: number | undefined
    if (/^[1-8]$/.test(word)) s = SCALE[Number(word) - 1]
    else if (word in WORDS) s = WORDS[word]
    else if (word.length === 1 && word in LETTERS) s = (((LETTERS[word] - home) % 12) + 12) % 12
    else if (word.length === 2 && word[0] in LETTERS && word[1] === 'b') s = (((LETTERS[word[0]] - 1 - home) % 12) + 12) % 12
    if (s === undefined) continue
    if (acc === '#' || acc === '♯') s += 1
    if (acc === 'b' || acc === '♭') s -= 1
    out.push(s + (up ? 12 : dotBefore || down ? -12 : 0))
  }
  return out
}

/** Notes → a line the person can read back and edit, in their notation. */
export function writeLine(notes: number[], notation: Notation, home: number) {
  return notes.map((s) => {
    const l = label(s, notation, home)
    return l.text + (l.oct > 0 ? "'" : l.oct < 0 ? ',' : '')
  }).join(' ')
}

// ---------------------------------------------------------------- the lessons

export type StepKind = 'intro' | 'drill' | 'practice' | 'test'

export const STEPS: Record<StepKind, { name: string; how: string; /** each note played before you sing it */ autoplay: boolean }> = {
  intro: { name: 'Meet the note', how: 'Listen, sing it back, and hold it until the ring fills.', autoplay: true },
  drill: { name: 'Drill', how: 'Every note is played for you first. Sing it back and hold.', autoplay: true },
  practice: { name: 'Practice', how: 'Only the first note is played. Stuck? Press space to hear the one you’re on.', autoplay: false },
  test: { name: 'Test', how: 'On your own: you hear your home note, then find the rest by ear.', autoplay: false },
}

export interface Lesson {
  id: string
  /** the note this lesson adds (an index into SCALE), or none for a review lesson */
  adds?: number
  /** title for review lessons (new-note lessons are titled "Meet Re" etc.) */
  title?: string
  about: string
  /** how long each note has to be held in tune, seconds */
  hold: number
  /** lines as scale degrees 1–8 */
  drill: number[]
  practice: number[]
  test: number[]
}

export const LESSONS: Lesson[] = [
  { id: 'l1', adds: 0, about: 'The note everything else is measured from.', hold: 1,
    drill: [1, 1, 1, 1], practice: [1, 1, 1, 1, 1, 1], test: [1, 1, 1, 1] },
  { id: 'l2', adds: 1, about: 'The first step up.', hold: 1,
    drill: [1, 2, 1, 2, 2, 1], practice: [1, 2, 1, 1, 2, 2, 1, 2, 1], test: [2, 1, 2, 1, 1, 2, 1] },
  { id: 'l3', adds: 2, about: 'Three notes: the start of every tune.', hold: 1,
    drill: [2, 3, 2, 3, 3, 2], practice: [1, 2, 3, 2, 1, 3, 1, 2, 3], test: [3, 2, 1, 1, 3, 2, 3, 1] },
  { id: 'l4', adds: 3, about: 'Only half a step above — listen closely.', hold: 1,
    drill: [3, 4, 3, 4, 4, 3], practice: [1, 2, 3, 4, 3, 2, 1, 4, 3, 4], test: [4, 3, 2, 1, 2, 4, 3, 1] },
  { id: 'l5', adds: 4, about: 'The strongest note after home.', hold: 1,
    drill: [4, 5, 4, 5, 5, 4], practice: [1, 2, 3, 4, 5, 4, 3, 2, 1, 5, 3, 5], test: [5, 4, 3, 5, 1, 3, 5, 1] },
  { id: 'l6', adds: 5, about: 'Past the middle of the scale.', hold: 1,
    drill: [5, 6, 5, 6, 6, 5], practice: [1, 3, 5, 6, 5, 4, 3, 6, 5, 6], test: [6, 5, 3, 1, 4, 6, 5, 1] },
  { id: 'l7', adds: 6, about: 'The note that leans up towards home.', hold: 1,
    drill: [6, 7, 6, 7, 7, 6], practice: [5, 6, 7, 6, 5, 3, 7, 6, 5, 7], test: [7, 6, 5, 4, 3, 2, 1, 7, 1] },
  { id: 'l8', adds: 7, about: 'Home again, one octave up: the whole scale.', hold: 1,
    drill: [7, 8, 7, 8, 8, 7], practice: [1, 2, 3, 4, 5, 6, 7, 8], test: [8, 7, 6, 5, 4, 3, 2, 1] },
  { id: 'l9', title: 'Up and down', about: 'The full scale, both ways, without stopping.', hold: 1,
    drill: [1, 2, 3, 4, 5, 6, 7, 8], practice: [8, 7, 6, 5, 4, 3, 2, 1], test: [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1] },
  { id: 'l10', title: 'Skips', about: 'Skip a note each time: one up, one back.', hold: 1,
    drill: [1, 3, 2, 4, 3, 5], practice: [1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 8], test: [8, 6, 7, 5, 6, 4, 5, 3, 4, 2, 3, 1] },
  { id: 'l11', title: 'Leaps', about: 'Big jumps — hear the note before you sing it.', hold: 1,
    drill: [1, 5, 1, 5], practice: [1, 5, 3, 8, 5, 1], test: [1, 8, 5, 3, 1, 4, 6, 8, 1] },
  { id: 'l12', title: 'Long notes', about: 'Hold each one steady for three seconds.', hold: 3,
    drill: [1, 3, 5], practice: [1, 5, 8, 5, 1], test: [8, 5, 3, 1] },
]

export const toSemis = (degrees: number[]) => degrees.map((d) => SCALE[d - 1])

export function lessonTitle(l: Lesson, notation: Notation, home: number) {
  if (l.adds === undefined) return l.title ?? ''
  if (l.adds === 0) return `Home note: ${homeName(notation, home)}`
  const n = label(SCALE[l.adds], notation, home)
  return `Meet ${n.text}${n.oct > 0 ? ' (high)' : ''}`
}

export function lessonSteps(l: Lesson): { kind: StepKind; notes: number[] }[] {
  const steps: { kind: StepKind; notes: number[] }[] = []
  if (l.adds !== undefined) {
    const s = SCALE[l.adds]
    steps.push({ kind: 'intro', notes: [s, s, s] })
  }
  steps.push({ kind: 'drill', notes: toSemis(l.drill) })
  steps.push({ kind: 'practice', notes: toSemis(l.practice) })
  steps.push({ kind: 'test', notes: toSemis(l.test) })
  return steps
}

/** The notes a lesson uses (for the course map and the stairs). */
export function lessonNotes(l: Lesson): number[] {
  return [...new Set([...l.drill, ...l.practice, ...l.test])].sort((a, b) => a - b).map((d) => SCALE[d - 1])
}

/** One sentence placing the new note: "Re sits a whole step above Sa." */
export function introText(l: Lesson, notation: Notation, home: number) {
  if (l.adds === undefined) return l.about
  if (l.adds === 0) return `${homeName(notation, home)} is your home note — every other note is measured from it. Listen, sing it back, hold it steady.`
  const now = label(SCALE[l.adds], notation, home).text
  const below = label(SCALE[l.adds - 1], notation, home).text
  const gap = SCALE[l.adds] - SCALE[l.adds - 1] === 1 ? 'just a half step' : 'a whole step'
  return `${now} sits ${gap} above ${below}. ${l.about}`
}

/** Stars for a stage: how close you were, and how quickly you found each note. */
export function starsFor(accuracy: number, findSeconds: number) {
  if (accuracy >= 88 && findSeconds <= 3) return 3
  if (accuracy >= 78 && findSeconds <= 6) return 2
  return 1
}
