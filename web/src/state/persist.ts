// Small localStorage helpers. Everything is per-browser and optional: the app
// works if storage is blocked.

import { DEFAULT_WEIGHTS, type Weights } from '../lib/evaluation'
import type { Attempt, BreathMark, LyricLine, ReferenceNote } from '../lib/types'

import { events } from './events'

export type LyricsScript = 'original' | 'latin' | 'deva' | 'urdu'
export type ThemeName = 'studio' | 'ink' | 'sage' | 'velvet' | 'mono'
export const THEMES: ThemeName[] = ['studio', 'ink', 'sage', 'velvet', 'mono']
/** Themes from earlier versions → their closest current one. */
const RENAMED: Record<string, ThemeName> = { stage: 'studio', midnight: 'ink', neon: 'velvet', serika: 'mono' }
/** line = one continuous melody line (default); bars = one block per note. */
export type MelodyView = 'line' | 'bars'
/** How much the pitch lines are smoothed for display (never affects scoring). */
export type LineDetail = 'smooth' | 'natural' | 'detailed'
/** shape = melody shape & expression (default, key/octave free); exact = also judge original pitch. */
export type ScoringMode = 'shape' | 'exact'
export interface GraphLayers {
  shape: boolean
  loudness: boolean
  exact: boolean
  timing: boolean
}

export interface Settings {
  theme: ThemeName
  /** true once the user picked a theme themselves (so defaults can improve for everyone else). */
  themePicked: boolean
  toleranceCents: number
  /** Manual latency compensation in ms; null = use the browser's estimate. */
  latencyMs: number | null
  showGrid: boolean
  showNoteNames: boolean
  melodyView: MelodyView
  lineDetail: LineDetail
  backingVolume: number
  guideVolume: number
  /** Volume of your own recorded take when listening back. */
  voiceVolume: number
  pxPerSec: number
  semitoneSpan: number
  tutorialDone: boolean
  scoringMode: ScoringMode
  weights: Weights
  showOverall: boolean
  /** Show the recent-attempts bars on the results screen (off by default). */
  showHistory: boolean
  /** Draw breath marks on the graph. */
  showBreaths: boolean
  /** Lyrics script: as found, Hinglish (latin), Hindi (deva) or Urdu. */
  lyricsScript: LyricsScript
  layers: GraphLayers
  /** Disco lights: glows at the screen's edges that pulse with the beat and follow the melody. */
  disco: boolean
  /** A take good enough for today's top is shared there (your name, photo, result and voice). */
  shareTop: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'studio',
  themePicked: false,
  toleranceCents: 50,
  latencyMs: null,
  showGrid: true,
  showNoteNames: true,
  melodyView: 'line',
  lineDetail: 'smooth',
  backingVolume: 0.8,
  guideVolume: 0.5,
  voiceVolume: 1,
  pxPerSec: 140,
  semitoneSpan: 16,
  tutorialDone: false,
  scoringMode: 'shape',
  weights: DEFAULT_WEIGHTS,
  showOverall: true,
  showHistory: false,
  showBreaths: true,
  lyricsScript: 'original',
  layers: { shape: true, loudness: true, exact: false, timing: true },
  disco: false,
  shareTop: true,
}

export interface SongPrefs {
  lyrics?: LyricLine[]
  /** true: the singer chose, pasted or edited these lyrics — never replaced automatically */
  lyricsMine?: boolean
  /** found automatically for this "title · artist" — looked up again if the song is renamed */
  lyricsFor?: string
  breaths?: BreathMark[]
  chart?: { notes: ReferenceNote[]; source: string; tempo?: number }
  offsetMs?: number
  attempts?: Attempt[]
  /** when this was last changed (ms) — the newer copy wins when syncing with your account */
  updatedAt?: number
}

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

function pickTheme(saved: Partial<Settings>): ThemeName {
  if (!saved.themePicked || !saved.theme) return 'studio'
  const t = RENAMED[saved.theme] ?? saved.theme
  return THEMES.includes(t) ? t : 'studio'
}

export const persist = {
  settings: (): Settings => {
    const saved = read<Partial<Settings>>('lemo.settings') ?? {}
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      theme: pickTheme(saved),
      melodyView: saved.melodyView === 'bars' ? 'bars' : 'line',
      lineDetail: (['smooth', 'natural', 'detailed'] as const).includes(saved.lineDetail as LineDetail) ? saved.lineDetail! : 'smooth',
      weights: { ...DEFAULT_WEIGHTS, ...(saved.weights ?? {}) },
      layers: { ...DEFAULT_SETTINGS.layers, ...(saved.layers ?? {}) },
    }
  },
  /** fromCloud: it came from your account — save it here without sending it back */
  saveSettings: (s: Settings, opts: { at?: number; fromCloud?: boolean } = {}) => {
    const at = opts.at ?? Date.now()
    write('lemo.settings', s)
    write('lemo.settings.at', at)
    if (!opts.fromCloud) events.emit('settingsSaved', s, at)
  },
  settingsAt: (): number => read<number>('lemo.settings.at') ?? 0,
  song: (id: string): SongPrefs => read<SongPrefs>(`lemo.song.${id}`) ?? {},
  saveSong: (id: string, prefs: SongPrefs, opts: { fromCloud?: boolean } = {}) => {
    const stamped = opts.fromCloud ? prefs : { ...prefs, updatedAt: Date.now() }
    write(`lemo.song.${id}`, stamped)
    if (!opts.fromCloud) events.emit('songSaved', id, stamped)
    return stamped
  },
  /** whose data this browser holds (Google uid) — so one person's data never syncs into another's account */
  owner: (): string | null => read<string>('lemo.owner'),
  setOwner: (uid: string) => write('lemo.owner', uid),
  /** a different person signed in: forget the previous person's settings and song data here
      (theirs is safe in their own account) */
  clearUserData: () => {
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && (k === 'lemo.settings' || k === 'lemo.settings.at' || k.startsWith('lemo.song.'))) keys.push(k)
      }
      keys.forEach((k) => localStorage.removeItem(k))
    } catch {
      /* storage blocked */
    }
  },
}
