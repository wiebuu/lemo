import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Link2, Loader2, Pause, Play, Search, X } from 'lucide-react'
import { analyzer, type CatalogItem } from '../api/analyzer'
import { formatTime } from '../lib/music'
import { searchSongs, youtubeId } from '../lib/songSearch'
import { cx, Tip } from './ui'

/**
 * The start box: type a song or a singer to find it among the songs Lemody already
 * has (they open straight away, ▶ plays 10 seconds first) — or paste a YouTube link
 * for anything else. A link to a song that's already here opens it without analysing again.
 */
export function SongSearch({ catalog, loading, busy, opening, disabled, newSongTime, onOpen, onLink, onTyping }: {
  catalog: CatalogItem[]
  /** the song list is still on its way */
  loading: boolean
  /** a link was sent and the analyzer hasn't answered yet */
  busy: boolean
  /** id of the song being opened */
  opening: string | null
  disabled: boolean
  /** "about 6 minutes": how long a new song takes */
  newSongTime: string | null
  onOpen: (id: string) => void
  onLink: (url: string) => void
  /** something is typed: the results take the song list's place */
  onTyping?: (typing: boolean) => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const preview = usePreview()
  const vid = youtubeId(q)
  const known = vid ? catalog.find((c) => c.id === `yt-${vid}`) : undefined
  const found = useMemo(() => (vid ? [] : searchSongs(catalog, q)), [catalog, q, vid])
  useEffect(() => setSel(0), [q])
  useEffect(() => () => preview.stop(), [])

  const typed = q.trim().length > 0
  useEffect(() => onTyping?.(typed), [typed, onTyping])
  const submit = () => {
    if (vid) {
      preview.stop()
      return onLink(q.trim())
    }
    const pick = found[sel]
    if (pick) {
      preview.stop()
      onOpen(pick.id)
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="relative rounded-xl surface focus-within:border-main/50 transition-colors"
      >
        {vid ? (
          <Link2 size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-main pointer-events-none" />
        ) : (
          <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-sub pointer-events-none" />
        )}
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, found.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            else if (e.key === 'Escape') setQ('')
          }}
          disabled={disabled}
          placeholder="search a song or singer — or paste a YouTube link"
          aria-label="search songs or paste a YouTube link"
          className="w-full bg-transparent rounded-xl pl-11 pr-28 py-3.5 text-[15px] text-text placeholder:text-sub outline-none"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {loading && typed && !vid && <Loader2 size={15} className="animate-spin text-sub mr-2" aria-label="loading songs" />}
          {typed && !busy && (
            <button type="button" onClick={() => setQ('')} aria-label="clear" className="p-1.5 text-sub hover:text-text">
              <X size={14} />
            </button>
          )}
          {vid && (
            <button type="submit" disabled={disabled || busy}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-main text-bg disabled:opacity-60">
              {busy && <Loader2 size={12} className="animate-spin" />}
              {busy ? 'checking' : known ? 'open' : 'analyse'}
            </button>
          )}
        </span>
      </form>

      {vid && known && (
        <p className="mt-2 px-1 text-[11px] text-sub fade-in">In Lemody: <span className="text-text">{known.title}</span></p>
      )}

      {typed && !vid && (
        <div className="mt-2 surface rounded-xl p-1 fade-in" role="listbox" aria-label="songs found">
          {loading && !catalog.length ? (
            <ResultSkeleton />
          ) : found.length ? (
            found.map((s, i) => (
              <div
                key={s.id}
                role="option"
                aria-selected={i === sel}
                onMouseEnter={() => setSel(i)}
                className={cx('group grid grid-cols-[2rem_1fr_auto] items-center gap-2 px-1.5 py-1.5 rounded-lg', i === sel && 'bg-sub-alt/60')}
              >
                <PreviewButton id={s.id} has={s.preview !== false} preview={preview} />
                <button type="button" disabled={!!opening} onClick={() => { preview.stop(); onOpen(s.id) }} className="min-w-0 text-left truncate">
                  <span className="text-[14px] font-medium text-text group-hover:text-main">{s.shownTitle}</span>
                  {s.shownArtist && <span className="text-[11px] text-sub ml-2">{s.shownArtist}</span>}
                  <Plays n={s.plays} />
                </button>
                <span className="flex items-center gap-2 text-[11px] text-sub tabular-nums pr-1">
                  {opening === s.id ? (
                    <span className="flex items-center gap-1 text-main"><Loader2 size={12} className="animate-spin" /> opening</span>
                  ) : (
                    <>
                      {s.duration ? formatTime(s.duration) : null}
                      <ArrowRight size={13} className="opacity-0 group-hover:opacity-100" />
                    </>
                  )}
                </span>
              </div>
            ))
          ) : (
            <div className="px-3 py-3 text-[13px] text-sub leading-relaxed">
              <span className="text-text">No “{q.trim()}” in Lemody yet.</span> Paste its YouTube link here and Lemody will add it
              {newSongTime ? ` (takes ${newSongTime})` : ''}.
            </div>
          )}
          {preview.error && <div className="px-3 pb-2 text-[11px] text-error">{preview.error}</div>}
        </div>
      )}
    </div>
  )
}

/** "· 12 plays": how many results people got on this song in Lemody. */
export function Plays({ n }: { n?: number }) {
  return n ? <span className="text-[11px] text-sub/70 ml-2 tabular-nums whitespace-nowrap">· {n} play{n > 1 ? 's' : ''}</span> : null
}

function ResultSkeleton() {
  return (
    <div aria-label="loading songs" className="flex flex-col gap-1 p-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-1 py-1.5">
          <span className="w-7 h-7 rounded-full skeleton" />
          <span className="h-3 rounded skeleton" style={{ width: `${55 - i * 12}%` }} />
        </div>
      ))}
    </div>
  )
}

export type Preview = ReturnType<typeof usePreview>

/** ▶ — 10 seconds of the song, with a ring that fills while it plays. */
export function PreviewButton({ id, has, preview }: { id: string; has: boolean; preview: Preview }) {
  const playing = preview.playing === id
  const loading = preview.loading === id
  return (
    <Tip tip={has ? (playing ? 'stop' : 'hear 10 seconds') : 'no preview for this song'}>
      <button
        type="button"
        disabled={!has}
        onClick={() => (playing ? preview.stop() : preview.play(id))}
        aria-label={playing ? 'stop preview' : 'play a 10-second preview'}
        className={cx('relative w-7 h-7 rounded-full flex items-center justify-center transition-colors disabled:opacity-30',
          playing ? 'bg-main text-bg' : 'bg-sub-alt text-text hover:bg-main hover:text-bg')}
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : playing ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
        {playing && (
          <svg viewBox="0 0 32 32" className="absolute -inset-[3px] w-[calc(100%+6px)] h-[calc(100%+6px)] -rotate-90 pointer-events-none" aria-hidden>
            <circle cx="16" cy="16" r="15" fill="none" stroke="var(--main)" strokeOpacity=".25" strokeWidth="2" />
            <circle cx="16" cy="16" r="15" fill="none" stroke="var(--main)" strokeWidth="2" strokeDasharray={94.2}
              strokeDashoffset={94.2 * (1 - preview.progress)} strokeLinecap="round" />
          </svg>
        )}
      </button>
    </Tip>
  )
}

/** One preview at a time; clips are kept for the visit so a second ▶ is instant. */
export function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null)
  const urls = useRef(new Map<string, string>())
  const want = useRef<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const stop = () => {
    want.current = null
    audio.current?.pause()
    setPlaying(null)
    setLoading(null)
    setProgress(0)
  }

  const play = async (id: string) => {
    stop()
    setError(null)
    want.current = id
    let url = urls.current.get(id)
    if (!url) {
      setLoading(id)
      try {
        url = URL.createObjectURL(await analyzer.preview(id))
        urls.current.set(id, url)
      } catch (e) {
        if (want.current === id) {
          setLoading(null)
          setError((e as Error).message)
        }
        return
      }
    }
    if (want.current !== id) return // another ▶ was pressed meanwhile
    setLoading(null)
    const a = audio.current ?? (audio.current = new Audio())
    a.src = url
    a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0)
    a.onended = () => stop()
    try {
      await a.play()
      setPlaying(id)
    } catch {
      setError('Your browser blocked the preview. Tap ▶ again.')
    }
  }

  useEffect(() => {
    const map = urls.current
    return () => map.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  return { play, stop, playing, loading, progress, error }
}
