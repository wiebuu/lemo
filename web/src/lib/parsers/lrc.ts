// LRC (line-synced lyrics) parser, e.g. from LRCLIB or a user-provided .lrc file.

import type { LyricLine } from '../types'

const TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g

export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = []
  let offset = 0
  for (const raw of text.split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(raw)
    if (off) {
      offset = Number(off[1]) / 1000
      continue
    }
    const times: number[] = []
    let m: RegExpExecArray | null
    TAG.lastIndex = 0
    let last = 0
    while ((m = TAG.exec(raw))) {
      times.push(Number(m[1]) * 60 + Number(m[2].replace(':', '.')))
      last = TAG.lastIndex
    }
    if (!times.length) continue
    const lyric = raw.slice(last).replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim()
    for (const t of times) {
      out.push({ id: `lrc${out.length}`, start: Math.max(0, t - offset), end: null, text: lyric, verified: false })
    }
  }
  out.sort((a, b) => a.start! - b.start!)
  for (let i = 0; i < out.length; i++) out[i].end = out[i + 1]?.start ?? out[i].start! + 4
  return out.filter((l) => l.text.length > 0)
}

export function toLrc(lines: LyricLine[]): string {
  return lines
    .map((l) => {
      if (l.start === null) return l.text
      const m = Math.floor(l.start / 60)
      const s = (l.start % 60).toFixed(2).padStart(5, '0')
      return `[${String(m).padStart(2, '0')}:${s}]${l.text}`
    })
    .join('\n')
}
