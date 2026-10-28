// Client for the local Python analyzer (proxied at /api by Vite).

import type { ReferenceTrack } from '../lib/types'

export interface AnalyzerHealth {
  ok: boolean
  youtube: boolean
  youtubeReason?: string
  separation: boolean
  melody: string
  rubberband: boolean
  ffmpeg: boolean
  device: string
  storage?: { featuredMb: number; cachedMb: number; cacheLimitMb: number; freeMb: number; usedMb?: number; limitMb?: number; full?: boolean }
  /** a new song takes about analysisRate × its length + analysisFixedSec here (learned) */
  analysisRate?: number
  analysisFixedSec?: number
  /** songs in the server's queue, and roughly how long until a new one would start */
  queue?: { songs: number; waitSec: number }
}

export interface LyricsCandidate {
  source: string
  match: string | null
  duration: number | null
  synced: string | null
  plain: string | null
  script: 'latin' | 'deva' | 'urdu' | 'none'
  /** how well its timing fits the singing (0..1); set when the song was checked */
  fit?: number | null
  /** its timing fits this recording */
  fits?: boolean
  /** the words of a version whose timing didn't fit, to be timed to the singer */
  retimed?: boolean
}

export interface LyricsResult extends Omit<LyricsCandidate, 'source' | 'script'> {
  source: string | null
  script?: LyricsCandidate['script']
  candidates: LyricsCandidate[]
  failedSources: string[]
  /** the best version already timed to the singer (prepared ahead of time on the server) */
  timed?: { start: number | null; end: number | null; text: string; words?: { start: number; end: number; text: string }[] | null }[]
}

export interface FeaturedItem {
  id: string | null
  title: string
  artist?: string
  lang?: string
  /** featured section: garhwali | hindi | kanye | english */
  group?: string
  duration: number | null
  ready: boolean
  stage: JobStage | 'waiting' | null
  progress: number
}

/** A stored song anyone can open straight away (it was analysed once, for everyone). */
export interface CatalogItem {
  id: string
  title: string
  artist?: string | null
  duration?: number | null
  lang?: string | null
  featured?: boolean
  preview?: boolean
  /** results people got on it (Explore's "most played") */
  plays?: number
}

export type JobStage = 'queued' | 'fetching' | 'preprocessing' | 'separating' | 'melody' | 'finishing' | 'done' | 'failed' | 'cancelled'

export interface JobStatus {
  id: string
  stage: JobStage
  progress: number
  message: string
  error?: string
  title?: string
  /** the song's length once known (s) */
  duration?: number | null
  /** estimated seconds left (for a queued song: including the ones ahead) */
  eta?: number | null
  /** songs being prepared before this one */
  ahead?: number
}

/** An analyzer error: `code` names a known case (e.g. "storage_full"), `info` carries its details. */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly info?: Record<string, unknown>
  constructor(message: string, status: number, code?: string, info?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.info = info
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    let code: string | undefined
    let info: Record<string, unknown> | undefined
    try {
      const d = (await res.json()).detail
      if (d && typeof d === 'object') {
        msg = d.message ?? msg
        code = d.code
        info = d
      } else if (d) msg = d
    } catch {
      /* not json */
    }
    throw new ApiError(msg, res.status, code, info)
  }
  return res.json() as Promise<T>
}

export const analyzer = {
  async health(): Promise<AnalyzerHealth | null> {
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(2500) })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  },
  analyzeUrl: (url: string) =>
    fetch('/api/songs/analyze', { method: 'POST', body: new URLSearchParams({ url }) }).then((r) => json<JobStatus>(r)),
  analyzeFile(file: File) {
    const fd = new FormData()
    fd.append('file', file)
    return fetch('/api/songs/analyze', { method: 'POST', body: fd }).then((r) => json<JobStatus>(r))
  },
  status: (id: string) => fetch(`/api/songs/${id}/status`).then((r) => json<JobStatus>(r)),
  cancel: (id: string) => fetch(`/api/songs/${id}/cancel`, { method: 'POST' }).then((r) => json<JobStatus>(r)),
  reference: (id: string) => fetch(`/api/songs/${id}/reference`).then((r) => json<ReferenceTrack>(r)),
  /** "Someone is practising" — the analyzer holds background work while this keeps coming. */
  activity: () => fetch('/api/activity', { method: 'POST' }).catch(() => undefined),
  /** someone got a result on this song: one more play for Explore */
  played: (id: string) => fetch(`/api/songs/${id}/played`, { method: 'POST' }).catch(() => undefined),
  /** every stored song, for search */
  catalog: () => fetch('/api/catalog').then((r) => json<CatalogItem[]>(r)),
  /** 10 seconds of a song (the most-sung part), to check it's the right one */
  preview: (id: string) =>
    fetch(`/api/songs/${id}/preview`).then((r) => {
      if (!r.ok) throw new ApiError(r.status === 404 ? 'No preview for this song yet.' : `Preview failed (${r.status})`, r.status)
      return r.blob()
    }),
  featured: () => fetch('/api/featured').then((r) => json<FeaturedItem[]>(r)),
  /** now: start right away, even while a song is open (otherwise it waits until nobody is practising) */
  prepareFeatured: (now = false) => fetch(`/api/featured/prepare${now ? '?now=true' : ''}`, { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  /** Send a song from this browser back to the analyzer (after it dropped it from its cache). */
  restore(id: string, reference: ReferenceTrack, backing: Blob, vocals: Blob) {
    const fd = new FormData()
    fd.append('reference', new Blob([JSON.stringify(reference)], { type: 'application/json' }), 'reference.json')
    fd.append('backing', backing, 'backing.m4a')
    fd.append('vocals', vocals, 'vocals.m4a')
    return fetch(`/api/songs/${id}/restore`, { method: 'POST', body: fd }).then((r) => json<{ ok: boolean; restored: boolean }>(r))
  },
  remove: (id: string) => fetch(`/api/songs/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  stemUrl: (id: string, stem: 'backing' | 'vocals', speed: number, semis: number) =>
    `/api/songs/${id}/audio/${stem}?speed=${speed}&semitones=${semis}&f=m4a`, // f: new address after the WAV → AAC change (old cache entries)
  align: (id: string, lines: { start: number; end: number; text: string }[]) =>
    fetch(`/api/songs/${id}/align`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }) }).then((r) =>
      json<{ status: 'running' | 'done' | 'failed' | 'unavailable'; lines?: ({ start: number; end: number; text: string }[] | null)[]; message?: string; error?: string }>(r),
    ),
  /** Time plain lyrics (no timestamps) to the singer, line by line. Poll until done. */
  alignPlain: (id: string, lines: string[]) =>
    fetch(`/api/songs/${id}/align-plain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }) }).then((r) =>
      json<{ status: 'running' | 'done' | 'failed'; lines?: { text: string; start: number | null; end: number | null; words: { start: number; end: number; text: string }[] | null }[]; message?: string; error?: string }>(r),
    ),
  /** Every lyrics source at once (LRCLIB, NetEase, the video's captions, lyrics.ovh): best first. */
  /** With `songId`, versions are checked against the song's singing: the ones that fit come first. */
  lyrics: (title: string, artist: string, duration: number, videoId?: string, songId?: string) =>
    fetch(`/api/lyrics?${new URLSearchParams({ title, artist, duration: String(Math.round(duration)), videoId: videoId ?? '', songId: songId ?? '' })}`).then((r) =>
      json<LyricsResult>(r),
    ),
  /** Lines in another script: latin (Hinglish) | deva (Hindi) | urdu. null = can't be converted. */
  script: (lines: string[], to: 'latin' | 'deva' | 'urdu') =>
    fetch('/api/lyrics/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines, to }) }).then((r) =>
      json<{ lines: (string | null)[] }>(r),
    ),
}
