import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Link2, Loader2, Pause, Play, Search, X } from 'lucide-react'
import { analyzer, type CatalogItem } from '../api/analyzer'
import { formatTime } from '../lib/music'
import { searchSongs } from '../lib/songSearch'
import { songLink } from '../lib/songLinks'
import { cx, Tip, usePhone } from './ui'

/**
 * The start box: type a song or a singer to find it among the songs Lemody already
 * has (they open straight away, ▶ plays 10 seconds first) — or paste a link: a song
 * file (Drive, Dropbox, …) is analysed on this device; a YouTube link to a song that's
 * already here opens it; any other site's link can be sent to Lemody to add.
 */
export function SongSearch({ catalog, loading, busy, opening, disabled, onOpen, onLink, onAsk, onTyping, actions }: {
  catalog: CatalogItem[]
  /** the song list is still on its way */
  loading: boolean
  /** a link was sent and the analyzer hasn't answered yet */
  busy: boolean
  /** id of the song being opened */
  opening: string | null
  disabled: boolean
  onOpen: (id: string) => void
  /** a song file link: analysed on this device */
  onLink: (url: string) => void
  /** a link from a site that doesn't let Lemody use it: Lemody adds it by hand */
  onAsk: (url: string) => void
  /** something is typed: the results take the song list's place */
  onTyping?: (typing: boolean) => void
  /** buttons beside the box (upload, try the demo) */
  actions?: React.ReactNode
}) {
  const phone = usePhone()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const preview = usePreview()
  const link = songLink(q)
  const vid = link?.kind === 'youtube' ? link.videoId : null
  const byId = vid ? catalog.find((c) => c.id === `yt-${vid}`) : undefined
  // a link from a site we can't take songs from: first, is it a song we already have
  // (maybe another upload of it)? The server checks by the link's name.
  const askable = !!link && link.kind !== 'file' && !byId
  const [matched, setMatched] = useState<{ url: string; song: { id: string; title: string; artist?: string | null } | null } | null>(null)
  useEffect(() => {
    if (!askable || !link) return
    const url = link.url
    let gone = false
    const t = setTimeout(() => {
      analyzer.matchLink(url).then((r) => !gone && setMatched({ url, song: r.song }), () => !gone && setMatched({ url, song: null }))
    }, 250)
    return () => { gone = true; clearTimeout(t) }
  }, [askable, link?.url]) // eslint-disable-line react-hooks/exhaustive-deps
  const checked = matched && link && matched.url === link.url ? matched : null
  const known = byId ?? (checked?.song ? { id: checked.song.id, title: checked.song.title } : undefined)
  const checking = askable && !checked
  const locked = askable && checked && !checked.song ? (link?.kind === 'locked' ? link.site : 'YouTube') : null
  const found = useMemo(() => (link ? [] : searchSongs(catalog, q)), [catalog, q, link])
  useEffect(() => setSel(0), [q])
  useEffect(() => () => preview.stop(), [])

  const typed = q.trim().length > 0
  useEffect(() => onTyping?.(typed), [typed, onTyping])
  const submit = () => {
    if (link) {
      preview.stop()
      if (known) return onOpen(known.id)
      if (link.kind === 'file') return onLink(link.url)
      return onAsk(link.url)
    }
    const pick = found[sel]
    if (pick) {
      preview.stop()
      onOpen(pick.id)
    }
  }

  return (
    <div>
      <div className="flex items-stretch gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="relative flex-1 min-w-0 rounded-xl surface focus-within:border-main/50 transition-colors"
      >
        {link ? (
          <Link2 size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-main pointer-events-none" />
        ) : (
          <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-sub pointer-events-none" />
        )}
        <input
          autoFocus={!phone} // phones: the keyboard would cover the page
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, found.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            else if (e.key === 'Escape') setQ('')
          }}
          disabled={disabled}
          placeholder={phone ? 'search or paste a link' : 'search a song or singer — or paste a link'}
          aria-label="search songs or paste a link"
          className={cx('w-full bg-transparent rounded-xl pl-11 py-2.5 sm:py-3.5 text-[14px] sm:text-[15px] text-text placeholder:text-sub outline-none', link ? 'pr-28' : typed ? 'pr-9' : 'pr-3')}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {loading && typed && !link && <Loader2 size={15} className="animate-spin text-sub mr-2" aria-label="loading songs" />}
          {typed && !busy && (
            <button type="button" onClick={() => setQ('')} aria-label="clear" className="p-1.5 text-sub hover:text-text">
              <X size={14} />
            </button>
          )}
          {link && (known || link.kind === 'file') && (
            <button type="submit" disabled={disabled || busy}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-main text-bg disabled:opacity-60">
              {busy && <Loader2 size={12} className="animate-spin" />}
              {busy ? 'checking' : known ? 'open' : 'analyse'}
            </button>
          )}
        </span>
      </form>
      {actions}
      </div>

      {checking && (
        <p className="mt-2 px-1 text-[11px] text-sub fade-in flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> checking if Lemody has it…</p>
      )}
      {link && known && (
        <p className="mt-2 px-1 text-[11px] text-sub fade-in">Already in Lemody: <span className="text-text">{known.title}</span>
          {checked?.song?.artist && <span> · {checked.song.artist}</span>}</p>
      )}
      {link?.kind === 'file' && (
        <p className="mt-2 px-1 text-[11px] text-sub fade-in">A song file from {link.from} — analysed on your device.</p>
      )}
      {locked && link && (
        <div className="mt-2 surface rounded-xl p-3 fade-in">
          <p className="text-[13px] text-text">{locked} doesn’t let Lemody use its songs.</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button type="button" disabled={disabled || busy} onClick={() => onAsk(link.url)}
              className="flex items-center gap-1.5 rounded-full bg-main text-bg text-xs font-medium px-4 py-1.5 disabled:opacity-60">
              {busy && <Loader2 size={12} className="animate-spin" />} ask Lemody to add it
            </button>
            <span className="text-[11px] text-sub">about a week · then it’s in your songs</span>
          </div>
        </div>
      )}

      {typed && !link && (
        <div className="mt-2 surface rounded-xl p-1 fade-in" role="listbox" aria-label="songs found">
          {loading && !catalog.length ? (
            <ResultSkeleton />
          ) : found.length ? (
            found.map((s, i) => (
              <div
                key={s.id}
                role="option"
                aria-selected={i === sel}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setSel(i)}
                // the highlighted row (for the keyboard / mouse) — not on touch screens, where it read as a stuck hover
                className={cx('group grid grid-cols-[2rem_1fr_auto] items-center gap-2 px-1.5 py-1.5 rounded-lg', i === sel && '[@media(pointer:fine)]:bg-sub-alt/60')}
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
              <span className="text-text">No “{q.trim()}” in Lemody yet.</span> Upload the song, or paste a link to it here —
              from any site.
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
