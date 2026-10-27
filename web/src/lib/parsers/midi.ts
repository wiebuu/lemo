// MIDI / karaoke (.kar) import. Picks the most melody-like track and reads
// lyric/text meta events when present.

import { Midi } from '@tonejs/midi'
import type { ReferenceNote } from '../types'

export interface MidiChart {
  title?: string
  notes: ReferenceNote[]
  trackName: string
  tempo?: number
}

export function parseMidi(data: ArrayBuffer): MidiChart {
  const midi = new Midi(data)
  const candidates = midi.tracks.filter((t) => t.notes.length >= 8 && t.channel !== 9)
  if (!candidates.length) throw new Error('No melodic tracks found in this MIDI file')

  // Score tracks: vocal-ish names win; otherwise prefer monophonic tracks in singing range.
  const scoreTrack = (t: (typeof candidates)[number]) => {
    const name = `${t.name} ${t.instrument.name}`.toLowerCase()
    let score = /vocal|voice|melody|lead|sing|choir/.test(name) ? 1000 : 0
    let overlap = 0
    let inRange = 0
    t.notes.forEach((n, i) => {
      if (n.midi >= 45 && n.midi <= 84) inRange++
      const next = t.notes[i + 1]
      if (next && next.time < n.time + n.duration - 0.02) overlap++
    })
    score += (inRange / t.notes.length) * 100 - (overlap / t.notes.length) * 200
    return score
  }
  const track = [...candidates].sort((a, b) => scoreTrack(b) - scoreTrack(a))[0]

  // Karaoke lyrics: text/lyrics meta events; '/' or '\' start a new line, '@' are headers.
  type Meta = { ticks: number; text: string; type: string }
  const metas: Meta[] = (midi.header.meta as Meta[]).filter(
    (m) => (m.type === 'lyrics' || m.type === 'text') && m.text && !m.text.startsWith('@'),
  )
  const lyricEvents = metas.map((m) => ({ time: midi.header.ticksToSeconds(m.ticks), text: m.text }))

  let line = 0
  let li = 0
  const notes: ReferenceNote[] = []
  const sorted = [...track.notes].sort((a, b) => a.time - b.time)
  for (const n of sorted) {
    let lyric: string | undefined
    while (li < lyricEvents.length && lyricEvents[li].time <= n.time + 0.03) {
      const ev = lyricEvents[li++]
      if (ev.time >= n.time - 0.08) {
        let txt = ev.text
        if (/^[/\\]/.test(txt)) {
          line++
          txt = txt.slice(1)
        }
        lyric = (lyric ?? '') + txt
      }
    }
    const prev = notes[notes.length - 1]
    if (!lyricEvents.length && prev && n.time - prev.endTime > 0.6) line++
    // Drop overlapping notes (keep the higher one, typical for melody lines).
    if (prev && n.time < prev.endTime - 0.02) {
      if (n.midi <= prev.midiPitch) continue
      prev.endTime = n.time
    }
    notes.push({
      startTime: n.time,
      endTime: n.time + n.duration,
      midiPitch: n.midi,
      confidence: 1,
      sung: true,
      lyric,
      line,
    })
  }
  return {
    title: midi.header.name || undefined,
    notes,
    trackName: track.name || track.instrument.name || 'track',
    tempo: midi.header.tempos[0]?.bpm,
  }
}
