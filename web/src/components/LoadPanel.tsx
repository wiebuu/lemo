import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Check, HardDrive, Loader2, Play, Trash2, Upload, X } from 'lucide-react'
import { ApiError, analyzer, type AnalyzerHealth, type CatalogItem, type FeaturedItem, type JobStage, type JobStatus, type SongRequest } from '../api/analyzer'
import { tidyTitle } from '../lib/titles'
import { songLink } from '../lib/songLinks'
import { cloudSongs, refreshCloudSongs } from '../state/cloud'
import { events } from '../state/events'
import { formatTime } from '../lib/music'
import { studio } from '../state/studio'
const AnalyseChoice = lazy(() => import('./DeviceAnalysis').then((m) => ({ default: m.AnalyseChoice })))
const DeviceRun = lazy(() => import('./DeviceAnalysis').then((m) => ({ default: m.DeviceRun })))
import { FeaturedShelf } from './FeaturedShelf'
import { Plays, PreviewButton, usePreview } from './SongSearch'
import { SongSearch } from './SongSearch'
import { Btn, cx, Eq, Tip } from './ui'

const STAGES: { id: JobStage; label: string }[] = [
  { id: 'fetching', label: 'get audio' },
  { id: 'preprocessing', label: 'prepare' },
  { id: 'separating', label: 'separate vocals' },
  { id: 'melody', label: 'extract melody' },
  { id: 'finishing', label: 'finish' },
]

/** Song input: YouTube link, audio upload, chart import, demo and library. */
export function LoadPanel({ onDone, inline }: { onDone: () => void; inline?: boolean }) {
  const [health, setHealth] = useState<AnalyzerHealth | null | undefined>(undefined)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [featured, setFeatured] = useState<FeaturedItem[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  // what's still on its way: the lists, a link just sent, a song being opened
  const [listsLoading, setListsLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const audioInput = useRef<HTMLInputElement>(null)

  const catalogAt = useRef(0)
  // songs you asked Lemody to add, still on their way
  const [requests, setRequests] = useState<SongRequest[]>([])
  const requestsAt = useRef(0)
  const loadRequests = useCallback(async () => {
    requestsAt.current = Date.now()
    const r = await analyzer.requests().catch(() => null)
    if (!r) return
    setRequests((before) => {
      if (before.some((b) => !r.some((x) => x.songId === b.songId))) void refreshCloudSongs() // one is ready: it's in your songs now
      return r
    })
  }, [])
  const misses = useRef(0)
  const refresh = useCallback(async () => {
    let h = await analyzer.health()
    // one slow answer isn't "offline": keep what we knew until it fails twice in a row
    misses.current = h ? 0 : misses.current + 1
    if (!h && misses.current < 2) h = await analyzer.health()
    setHealth(h)
    const lists: Promise<unknown>[] = []
    if (h) {
      lists.push(analyzer.featured().then(setFeatured).catch(() => setFeatured([])))
      if (Date.now() - requestsAt.current > 30_000) void loadRequests()
      if (Date.now() - catalogAt.current > 30_000) { // every stored song: rarely changes
        catalogAt.current = Date.now()
        analyzer.catalog().then(setCatalog).catch(() => {}).finally(() => setCatalogLoading(false))
      }
    } else setCatalogLoading(false)
    await Promise.allSettled(lists)
    setListsLoading(false)
  }, [loadRequests])

  const open = async (id: string) => {
    setErr(null)
    setOpening(id)
    try {
      await studio.loadAnalyzed(id)
      onDone()
    } catch (e) {
      setErr(`Couldn't open that song: ${(e as Error).message}`)
    } finally {
      setOpening(null)
    }
  }

  useEffect(() => {
    void refresh()
    const id = setInterval(() => !job && refresh(), 5000)
    return () => clearInterval(id)
  }, [refresh, job])

  // A song being prepared keeps going on the server if you leave: pick its progress up again.
  useEffect(() => {
    let id: string | null = null
    try {
      id = localStorage.getItem('lemo.job')
    } catch {
      /* blocked */
    }
    if (!id) return
    analyzer.status(id).then(
      (st) => (['done', 'failed', 'cancelled'].includes(st.stage) ? forgetJob() : setJob((j) => j ?? st)),
      () => forgetJob(),
    )
  }, [])
  useEffect(() => {
    if (job && !['done', 'failed', 'cancelled'].includes(job.stage)) rememberJob(job.id)
    else if (job) forgetJob()
  }, [job])

  // Poll the running job.
  useEffect(() => {
    if (!job || ['done', 'failed', 'cancelled'].includes(job.stage)) return
    const id = setInterval(async () => {
      try {
        const st = await analyzer.status(job.id)
        setJob(st)
        if (st.stage === 'done') await open(st.id)
        else if (st.stage === 'failed') setErr(st.error ?? 'Analysis failed')
      } catch (e) {
        setErr((e as Error).message)
        setJob(null)
      }
    }, 800)
    return () => clearInterval(id)
  }, [job, onDone])

  // lemo's song storage is at its limit: new songs are refused (shown as a card, not an error line)
  const [full, setFull] = useState<{ message: string; usedGb?: number; limitGb?: number } | null>(null)
  const storageFull = () => {
    const st = health?.storage
    if (!st?.full) return false
    setFull({ message: '', usedGb: (st.usedMb ?? 0) / 1024, limitGb: (st.limitMb ?? 0) / 1024 })
    return true
  }

  const start = async (p: Promise<JobStatus>) => {
    setErr(null)
    setFull(null)
    setSending(true)
    try {
      const st = await p
      if (st.stage === 'done') await open(st.id) // already stored: opens without analysing again
      else setJob(st)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'storage_full') {
        setFull({ message: e.message, usedGb: e.info?.usedGb as number, limitGb: e.info?.limitGb as number })
      } else setErr((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  // a new song: analyse it on this device or on the server (the user picks)
  // a YouTube link, or the singer's own audio file
  const [choosing, setChoosing] = useState<string | File | null>(null)
  const [onDevice, setOnDevice] = useState<string | File | null>(null)
  const useServer = (u: string | File) => {
    setChoosing(null)
    setOnDevice(null)
    // when storage is full the analyzer says so (a song already stored still opens)
    void start(typeof u === 'string' ? analyzer.analyzeUrl(u) : analyzer.analyzeFile(u))
  }
  // "we'll do it for you": added by hand within a week, then it's in your songs
  const [asked, setAsked] = useState<string | null>(null)
  const askLemody = async (u: string) => {
    setChoosing(null)
    setOnDevice(null)
    setErr(null)
    try {
      const r = await analyzer.requestSong(u)
      if (r.state === 'ready') return void open(r.id) // it's already in Lemody
      setAsked(r.title || 'this song')
      void loadRequests()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
    /** a link to a song file (Drive, Dropbox, …): analysed on this device */
  const submitUrl = (u: string) => {
    if (!health) return setErr('Lemody\u2019s server can\u2019t be reached right now. Try again in a minute.')
    setErr(null)
    if (storageFull()) return
    setChoosing(u)
  }
  const serverSec = (health?.queue?.waitSec ?? 0) + (health?.analysisRate ?? 1.4) * 240 + (health?.analysisFixedSec ?? 8)

  const running = (job && !['done', 'failed', 'cancelled'].includes(job.stage)) || !!onDevice
  const stageIdx = job ? STAGES.findIndex((s) => s.id === job.stage) : -1

  return (
    <div className={cx('w-full', inline && 'max-w-3xl mx-auto my-auto max-h-full min-h-0 flex flex-col')}>
      {inline && <Hero />}
      <SongSearch
        catalog={catalog}
        loading={catalogLoading}
        busy={sending}
        opening={opening}
        disabled={!!running}
        onOpen={(id) => void open(id)}
        onLink={submitUrl}
        onAsk={(u) => void askLemody(u)}
        onTyping={setTyping}
      />

      <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-3 text-xs">
        <Btn onClick={() => audioInput.current?.click()} disabled={!!running || !health} title={health ? 'a song file from your phone or computer' : 'needs Lemody\u2019s server'}>
          <Upload size={13} /> upload a song
        </Btn>
        <Btn
          primary
          disabled={!!running}
          onClick={async () => {
            await studio.loadDemo()
            onDone()
          }}
        >
          <Play size={13} /> try the demo
        </Btn>
        <input ref={audioInput} type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && !storageFull()) { setErr(null); setChoosing(f) } }} />
      </div>
      {!typing && !running && !choosing && (
        <ul className="mt-2 sm:mt-3 px-1 flex flex-col gap-0.5 sm:gap-1 text-[11px] text-sub leading-snug">
          <li><span className="text-text">Your own song</span> — upload the file, or paste a Google Drive / Dropbox link. It’s analysed on your device.</li>
          <li><span className="text-text">From YouTube, Spotify or another app</span> — paste the link and ask Lemody. It’s added in about a week.</li>
        </ul>
      )}

      <Suspense fallback={choosing || onDevice ? <div className="mt-4 flex justify-center"><Eq /></div> : null}>
      {choosing && !onDevice && (
        <AnalyseChoice
          name={songName(choosing)}
          health={health}
          onDevice={() => { setOnDevice(choosing); setChoosing(null) }}
          onServer={() => useServer(choosing)}
          onCancel={() => setChoosing(null)}
        />
      )}
      {onDevice && (
        <DeviceRun
          url={onDevice}
          serverSec={serverSec}
          onDone={(id) => { setOnDevice(null); void open(id) }}
          onUseServer={health?.separation ? () => useServer(onDevice) : undefined}
          onCancel={() => setOnDevice(null)}
        />
      )}
      </Suspense>
      {asked && (
        <div className="fade-in mt-4 surface rounded-2xl p-4 flex items-start justify-between gap-3">
          <div className="text-[13px] text-sub leading-relaxed">
            <span className="text-text font-medium">Got it.</span> We’ll add <span className="text-text">{asked}</span> within a week —
            it’ll show up in your songs, and everyone can sing it.
          </div>
          <button type="button" onClick={() => setAsked(null)} className="text-xs text-sub hover:text-text shrink-0">close</button>
        </div>
      )}

      {job && (
        <div className="mt-6 fade-in">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-text truncate">{job.title ?? 'analysing'}</span>
            {running && (
              <button type="button" className="text-sub hover:text-error" onClick={async () => setJob(await analyzer.cancel(job.id))}>
                cancel
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {STAGES.map((st, i) => (
              <span key={st.id} className={cx('flex items-center gap-1', i < stageIdx || job.stage === 'done' ? 'text-text' : i === stageIdx ? 'text-main' : 'text-sub')}>
                {i < stageIdx || job.stage === 'done' ? <Check size={12} /> : i === stageIdx ? <Loader2 size={12} className="animate-spin" /> : null}
                {st.label}
              </span>
            ))}
          </div>
          <div className="h-1 bg-sub-alt rounded-full mt-3 overflow-hidden">
            <div className="h-full bg-main rounded-full transition-[width] duration-700 ease-out" style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          <div className="flex items-baseline justify-between gap-3 text-xs mt-2">
            <span className="text-sub truncate">{job.stage === 'cancelled' ? 'cancelled' : job.stage === 'queued' && job.ahead ? `waiting — ${job.ahead} song${job.ahead > 1 ? 's' : ''} ahead` : job.message}</span>
            {running && (
              <span className="shrink-0 tabular-nums">
                {job.stage !== 'queued' && <span className="text-text font-medium">{Math.round(job.progress * 100)}%</span>}
                {job.eta != null && <span className="text-sub">{job.stage !== 'queued' && ' · '}{timeLeft(job.eta)}</span>}
              </span>
            )}
          </div>
          {running && (
            <p className="mt-2 text-[11px] text-sub">You can close Lemody: it keeps going.</p>
          )}
        </div>
      )}

      {full && <StorageFull {...full} onClose={() => setFull(null)} />}
      {err && <div className="mt-4 text-xs text-error leading-relaxed">{err}</div>}

      {!typing && <SongList
        featured={featured}
        catalog={catalog}
        online={!!health}
        fill={inline}
        opening={opening}
        loading={listsLoading}
        onOpen={(id) => void open(id)}
        canPrepare={!!health?.separation}
        requests={requests}
        onCancelRequest={async (id) => { setRequests((r) => r.filter((x) => x.songId !== id)); await analyzer.cancelRequest(id).catch(() => {}) }}
        onPrepare={async (now) => { await analyzer.prepareFeatured(now).catch((e) => setErr((e as Error).message)); void refresh() }}
        onFetch={(id) => (catalog.some((c) => c.id === id) ? void open(id) : void askLemody(`https://www.youtube.com/watch?v=${id.slice(3)}`))}
        onRemove={async (id) => {
          // off your list; a file you uploaded is also deleted from the server (YouTube songs stay for everyone)
          events.emit('songRemoved', id)
          if (id.startsWith('up-')) await analyzer.remove(id).catch(() => {})
          void refresh()
        }}
      />}
    </div>
  )
}

/** Shown when someone adds a song while lemo's song storage is at its limit. */
function StorageFull({ message, usedGb, limitGb, onClose }: { message: string; usedGb?: number; limitGb?: number; onClose: () => void }) {
  const pct = usedGb && limitGb ? Math.min(100, (usedGb / limitGb) * 100) : 100
  return (
    <div role="alert" className="fade-in mt-5 surface rounded-2xl p-4 sm:p-5 relative">
      <button type="button" onClick={onClose} aria-label="close" className="absolute top-3 right-3 text-sub hover:text-text p-1">
        <X size={14} />
      </button>
      <div className="flex gap-3.5">
        <span className="shrink-0 w-10 h-10 rounded-full bg-error/12 text-error flex items-center justify-center">
          <HardDrive size={18} />
        </span>
        <div className="min-w-0 pr-5">
          <div className="text-sm font-semibold text-text">Song storage is full</div>
          <p className="mt-1 text-[13px] text-sub leading-relaxed">
            {message || `Lemody has used all ${limitGb ? `${limitGb} GB` : 'the space'} set aside for songs, so new songs can't be added right now.`}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-sub-alt overflow-hidden">
              <div className="h-full rounded-full bg-error" style={{ width: `${pct}%` }} />
            </div>
            {usedGb !== undefined && limitGb ? (
              <span className="text-[11px] text-sub tabular-nums shrink-0">{usedGb.toFixed(1)} / {limitGb} GB</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/** "about 4 min left" — rounded the way people say it. */
function timeLeft(sec: number): string {
  if (sec < 40) return 'almost done'
  if (sec < 90) return 'about a minute left'
  return `about ${Math.round(sec / 60)} min left`
}


function rememberJob(id: string) {
  try {
    localStorage.setItem('lemo.job', id)
  } catch {
    /* blocked */
  }
}
function forgetJob() {
  try {
    localStorage.removeItem('lemo.job')
  } catch {
    /* blocked */
  }
}

const GROUPS: { id: string; label: string }[] = [
  { id: 'garhwali', label: 'garhwali' },
  { id: 'kanye', label: 'kanye' },
  { id: 'hindi', label: 'hindi' },
  { id: 'english', label: 'english' },
]
const groupOf = (f: FeaturedItem) => f.group ?? (f.lang === 'gw' ? 'garhwali' : f.lang === 'hi' ? 'hindi' : 'english')

/**
 * Featured songs live on the server for everyone, in three short lists: garhwali,
 * hindi, kanye. Explore has every song, most played first. "your songs" are the ones you added
 * (kept in your account; the songs themselves live on Lemody's server).
 */
function SongList({ featured, catalog, online, canPrepare, requests, onCancelRequest, fill, opening, loading, onOpen, onFetch, onPrepare, onRemove }: {
  featured: FeaturedItem[]
  /** songs you asked Lemody to add, still on their way */
  requests: SongRequest[]
  onCancelRequest: (id: string) => void
  /** the server analyses songs itself (featured ones can be prepared there) */
  canPrepare: boolean
  /** every stored song (Explore: most played first) */
  catalog: CatalogItem[]
  /** id of the song being opened */
  opening: string | null
  /** the lists are still on their way */
  loading: boolean
  online: boolean
  /** On the start page the list takes the remaining height (and scrolls) so the page never does. */
  fill?: boolean
  onOpen: (id: string) => void
  /** a YouTube song of yours: opens straight away when the server has it, else it's analysed again */
  onFetch: (id: string) => void
  onPrepare: (now: boolean) => void
  onRemove: (id: string) => void
}) {
  const own = cloudSongs().map((it) => ({ ...it, full: it.title, ...tidyTitle(it.title, it.artist) }))
  const plays = new Map(catalog.map((c) => [c.id, c.plays ?? 0]))
  const preview = usePreview()
  useEffect(() => () => preview.stop(), [])
  const [tab, setTab] = useState<'featured' | 'explore' | 'mine'>('featured')
  // Featured stays the first tab while it loads (placeholder rows), instead of showing
  // "your songs" and then jumping to featured when it arrives.
  const featuredLoading = loading && !featured.length
  const show = tab !== 'featured' ? tab : featured.length || featuredLoading ? 'featured' : 'mine'
  if (loading && !featured.length && !own.length) return <ListSkeleton fill={fill} />
  if (!featured.length && !own.length && !requests.length) return null
  const waiting = featured.filter((f) => !f.ready)
  const idle = waiting.length > 0 && waiting.every((f) => !f.stage || f.stage === 'failed' || f.stage === 'cancelled')

  return (
    <div className={cx('mt-4 sm:mt-8', fill && 'flex-1 min-h-0 flex flex-col')}>
      {(featured.length > 0 || featuredLoading) && (
        <div className="flex items-center gap-5 mb-3 shrink-0 text-xs">
          {([['featured', 'featured'], ['explore', 'explore'], ['mine', `your songs${own.length + requests.length ? ` · ${own.length + requests.length}` : ''}`]] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setTab(v)}
              className={cx('relative pb-1.5 tracking-wide', show === v ? 'text-text' : 'text-sub hover:text-text')}>
              {label}
              <span className={cx('absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-grad transition-opacity', show === v ? 'opacity-100' : 'opacity-0')} />
            </button>
          ))}
          <span className="flex-1 h-px bg-line" />
        </div>
      )}
      <div className={cx('overflow-y-auto -mx-2 px-2', fill ? 'flex-1 min-h-0' : 'max-h-[42vh]')}>
        {show === 'explore' ? (
          <Explore catalog={catalog} opening={opening} online={online} onOpen={onOpen} />
        ) : show === 'featured' && featuredLoading ? (
          <SkeletonRows />
        ) : show === 'featured' ? (
          <>
            {GROUPS.map((g) => {
              const items = featured.filter((f) => groupOf(f) === g.id)
              return items.length ? (
                <FeaturedShelf key={g.id} label={g.label} items={items} plays={plays} opening={opening} preview={preview} onOpen={(id) => { preview.stop(); onOpen(id) }} />
              ) : null
            })}
            {online && canPrepare && idle && (
              <Tip tip="Prepares them one at a time in the background.">
                <button type="button" onClick={() => onPrepare(true)} className="mt-3 px-2 text-xs text-sub hover:text-main">
                  {`prepare the ${waiting.length} songs that aren\u2019t ready →`}
                </button>
              </Tip>
            )}
          </>
        ) : own.length || requests.length ? (
          <ol className="flex flex-col">
            {requests.map((r) => (
              <li key={r.songId} className="group grid grid-cols-[1.75rem_1fr_auto_auto] items-baseline gap-3 px-2 py-1.5 rounded-lg">
                <span className="text-[11px] text-sub">··</span>
                <span className="min-w-0 truncate text-[14px] text-sub" title={r.title ?? ''}>{r.title ?? 'requested song'}</span>
                <span className="text-[11px] text-main">requested · within a week</span>
                <Tip tip="cancel this request">
                  <button type="button" aria-label="cancel this request" onClick={() => onCancelRequest(r.songId)}
                    className="text-sub hover:text-error self-center p-1 -m-1 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                    <X size={13} />
                  </button>
                </Tip>
              </li>
            ))}
            {own.map((it, n) => (
              <li key={it.id} className="track group grid grid-cols-[1.75rem_1fr_auto_auto] items-baseline gap-3 px-2 py-1.5 rounded-lg">
                <span className="text-[11px] text-sub tabular-nums">{String(n + 1).padStart(2, '0')}</span>
                <button
                  type="button"
                  disabled={!online || !!opening}
                  title={it.full}
                  className="min-w-0 text-left truncate"
                  onClick={() => (it.id.startsWith('yt-') ? onFetch(it.id) : onOpen(it.id))}
                >
                  <span className="text-[14px] font-medium text-text group-hover:text-main">{it.title}</span>
                  {it.artist && <span className="text-[11px] text-sub ml-2">{it.artist}</span>}
                  <Plays n={plays.get(it.id)} />
                </button>
                <span className="text-[11px] text-sub tabular-nums">
                  {opening === it.id ? <span className="flex items-center gap-1 text-main"><Loader2 size={11} className="animate-spin" />opening</span> : formatTime(it.duration)}
                </span>
                <Tip tip={it.id.startsWith('up-') ? 'remove this song (your uploaded file is deleted too)' : 'remove from your songs'}>
                  <button
                    type="button"
                    aria-label="remove from your songs"
                    className="text-sub hover:text-error self-center p-1 -m-1 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => onRemove(it.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </Tip>
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-xs text-sub py-2 px-2">songs you open or add show up here — on every device you sign in on. nothing is stored on your phone.</div>
        )}
      </div>
    </div>
  )
}

/** Every song in Lemody, the most played first (a play = someone got a result on it). */
const EXPLORE_TOP = 100
const EXPLORE_PAGE = 20

/** The 100 most played songs (then the newest, while few have been played), 20 to a page. */
function Explore({ catalog, opening, online, onOpen }: { catalog: CatalogItem[]; opening: string | null; online: boolean; onOpen: (id: string) => void }) {
  const preview = usePreview()
  const [page, setPage] = useState(0)
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => () => preview.stop(), [])
  if (!catalog.length) return <SkeletonRows />
  const ranked = [...catalog]
    .sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0) || (b.addedAt ?? 0) - (a.addedAt ?? 0))
    .slice(0, EXPLORE_TOP)
  const pages = Math.ceil(ranked.length / EXPLORE_PAGE)
  const at = Math.min(page, pages - 1)
  const songs = ranked.slice(at * EXPLORE_PAGE, (at + 1) * EXPLORE_PAGE).map((c) => ({ ...c, ...tidyTitle(c.title, c.artist) }))
  const go = (p: number) => {
    preview.stop()
    setPage(p)
    top.current?.scrollIntoView({ block: 'nearest' })
  }
  return (
    <div ref={top}>
      <ol className="flex flex-col">
        {songs.map((it, i) => {
          const n = at * EXPLORE_PAGE + i
          return (
            <li key={it.id} className="track group grid grid-cols-[1.75rem_2rem_1fr_auto_auto] items-center gap-2 px-2 py-1 rounded-lg">
              <span className={cx('text-[11px] tabular-nums', n < 3 && (it.plays ?? 0) > 0 ? 'text-main font-medium' : 'text-sub')}>{String(n + 1).padStart(2, '0')}</span>
              <PreviewButton id={it.id} has={it.preview !== false} preview={preview} />
              <button type="button" disabled={!online || !!opening} onClick={() => { preview.stop(); onOpen(it.id) }} className="min-w-0 text-left truncate">
                <span className="text-[14px] font-medium text-text group-hover:text-main">{it.title}</span>
                {it.artist && <span className="text-[11px] text-sub ml-2">{it.artist}</span>}
              </button>
              <span className="text-[11px] text-sub tabular-nums">{it.plays ? `${it.plays} play${it.plays > 1 ? 's' : ''}` : ''}</span>
              <span className="text-[11px] text-sub tabular-nums w-9 text-right">
                {opening === it.id ? <Loader2 size={11} className="animate-spin inline text-main" /> : it.duration ? formatTime(it.duration) : ''}
              </span>
            </li>
          )
        })}
      </ol>
      {pages > 1 && (
        <nav aria-label="pages" className="flex items-center justify-center gap-1 pt-3 pb-1 text-xs">
          <button type="button" aria-label="previous page" disabled={at === 0} onClick={() => go(at - 1)}
            className="w-8 h-8 rounded-full text-sub hover:text-text disabled:opacity-30">‹</button>
          {Array.from({ length: pages }, (_, p) => (
            <button key={p} type="button" aria-current={p === at ? 'page' : undefined} onClick={() => go(p)}
              className={cx('w-8 h-8 rounded-full tabular-nums', p === at ? 'bg-main text-bg font-medium' : 'text-sub hover:text-text')}>
              {p + 1}
            </button>
          ))}
          <button type="button" aria-label="next page" disabled={at === pages - 1} onClick={() => go(at + 1)}
            className="w-8 h-8 rounded-full text-sub hover:text-text disabled:opacity-30">›</button>
        </nav>
      )}
    </div>
  )
}

function SkeletonRows() {
  return (
    <div aria-label="loading songs" className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3 pt-1">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-1">
          <span className="h-2.5 w-4 rounded skeleton" />
          <span className="h-3 rounded skeleton" style={{ width: `${70 - (i % 4) * 11}%` }} />
        </div>
      ))}
    </div>
  )
}

/** Placeholder tracklist while the song lists load. */
function ListSkeleton({ fill }: { fill?: boolean }) {
  return (
    <div aria-label="loading songs" className={cx('mt-8', fill && 'flex-1 min-h-0')}>
      <div className="flex items-center gap-5 mb-4">
        <span className="h-3 w-16 rounded skeleton" />
        <span className="h-3 w-20 rounded skeleton" />
        <span className="flex-1 h-px bg-line" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-1">
            <span className="h-2.5 w-4 rounded skeleton" />
            <span className="h-3 rounded skeleton" style={{ width: `${70 - (i % 4) * 11}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The start screen's headline, under a staff with a melody drifting across it. */
function Hero() {
  return (
    <div className="hero mb-4 sm:mb-7 shrink-0 fade-in">
      <svg viewBox="0 0 640 46" className="hero-staff w-full h-6 mb-2 sm:h-9 sm:mb-4" aria-hidden preserveAspectRatio="none">
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1="0" x2="640" y1={5 + i * 9} y2={5 + i * 9} stroke="var(--text)" strokeOpacity=".07" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d="M0 34 C60 34 70 16 120 16 S190 38 250 30 S330 8 390 12 S470 34 520 22 S600 10 640 14"
          fill="none" stroke="var(--main)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <h1 className="hero-title text-[28px] sm:text-[44px] leading-[1.05] font-semibold text-text tracking-[-0.035em]">
        What are we <span className="text-main">singing</span> today?
      </h1>
    </div>
  )
}

/** What to call a picked song before it's analysed: the file's name, or where its link points. */
export function songName(src: string | File): string {
  if (typeof src !== 'string') return src.name.replace(/\.[^.]+$/, '')
  const link = songLink(src)
  try {
    const file = decodeURIComponent(new URL(link?.url ?? src).pathname.split('/').pop() ?? '')
    if (/\.\w{2,4}$/.test(file)) return file.replace(/\.[^.]+$/, '')
  } catch {
    /* not a full link */
  }
  return link?.kind === 'file' && link.from !== 'a link' ? `your song from ${link.from}` : src
}
