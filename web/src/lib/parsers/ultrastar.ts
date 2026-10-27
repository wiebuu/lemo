// UltraStar .txt chart parser. A chart is a human transcription of the vocal
// melody — when available it is more reliable than ML extraction.
// Pitch 0 = C4 (MIDI 60). Beat length = 60 / (BPM * 4) seconds. #GAP in ms.

import { lyricsFromNotes } from '../phrases'
import type { ReferenceNote, ReferenceTrack } from '../types'

export interface UltraStarChart {
  title: string
  artist?: string
  bpm: number
  gapMs: number
  notes: ReferenceNote[]
}

export function parseUltraStar(text: string): UltraStarChart {
  const headers: Record<string, string> = {}
  const raw: { type: string; beat: number; len: number; pitch: number; text: string; line: number }[] = []
  let line = 0
  let relative = false
  let relOffset = 0

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine) continue
    if (rawLine.startsWith('#')) {
      const i = rawLine.indexOf(':')
      if (i > 0) headers[rawLine.slice(1, i).trim().toUpperCase()] = rawLine.slice(i + 1).trim()
      if (headers.RELATIVE?.toLowerCase() === 'yes') relative = true
      continue
    }
    const type = rawLine[0]
    if (type === 'E') break
    if (type === '-') {
      line++
      if (relative) {
        const parts = rawLine.slice(1).trim().split(/\s+/).map(Number)
        relOffset += parts[1] ?? parts[0] ?? 0
      }
      continue
    }
    if (!':*FRG'.includes(type)) continue
    const m = /^.\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s?(.*)$/.exec(rawLine)
    if (!m) continue
    raw.push({
      type,
      beat: Number(m[1]) + (relative ? relOffset : 0),
      len: Number(m[2]),
      pitch: Number(m[3]),
      text: m[4] ?? '',
      line,
    })
  }

  const bpm = parseFloat((headers.BPM ?? '').replace(',', '.'))
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('UltraStar chart is missing a valid #BPM')
  if (!raw.length) throw new Error('UltraStar chart contains no notes')
  const gapMs = parseFloat((headers.GAP ?? '0').replace(',', '.')) || 0
  const beatSec = 60 / (bpm * 4)

  const notes: ReferenceNote[] = raw.map((r) => ({
    startTime: gapMs / 1000 + r.beat * beatSec,
    endTime: gapMs / 1000 + (r.beat + Math.max(1, r.len)) * beatSec,
    midiPitch: 60 + r.pitch,
    confidence: 1,
    sung: r.type === ':' || r.type === '*' || r.type === 'G',
    lyric: r.text.replace(/~/g, ''),
    line: r.line,
  }))
  notes.sort((a, b) => a.startTime - b.startTime)
  return { title: headers.TITLE ?? 'Untitled', artist: headers.ARTIST, bpm, gapMs, notes }
}

/** Merge a chart into an existing track (keeps the track's audio/duration). */
export function applyChart(
  base: ReferenceTrack,
  notes: ReferenceNote[],
  melodySource: string,
  tempo?: number,
): ReferenceTrack {
  const lyrics = lyricsFromNotes(notes)
  return {
    ...base,
    notes,
    contour: undefined,
    lyrics: lyrics.length ? lyrics : base.lyrics,
    lyricsTiming: lyrics.length ? 'word' : base.lyricsTiming,
    melodySource,
    analysisStatus: 'ready',
    tempo: tempo ?? base.tempo,
  }
}
