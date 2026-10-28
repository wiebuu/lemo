import { useEffect, useState } from 'react'
import { Crown, Play } from 'lucide-react'
import { analyzer, type SiteStats, type TopBoard, type TopEntry } from '../api/analyzer'
import { useAuth } from '../auth/firebase'
import { formatTime } from '../lib/music'
import { tidyTitle } from '../lib/titles'
import { studio } from '../state/studio'
import { cx } from '../components/ui'
import { go, navigate } from './router'

const pct = (v: number) => `${Math.round(v * 100)}%`

/** Loads something for a page once; signed out, or offline, it says so instead. */
function useLoad<T>(load: () => Promise<T>, open = false): { data: T | null; error: string | null } {
  const auth = useAuth()
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  const ready = open ? auth.status !== 'loading' : auth.status === 'signed-in'
  useEffect(() => {
    if (!ready) return
    let live = true
    load().then((data) => live && setState({ data, error: null }), (e: Error) => live && setState({ data: null, error: e.message }))
    return () => {
      live = false
    }
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps
  if (auth.status === 'signed-out' && !open) return { data: null, error: 'Sign in on the home page to see this.' }
  return state
}

function until(t: number): string {
  const s = Math.max(0, t - Date.now() / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

function ago(at: number): string {
  const s = Math.max(0, Date.now() / 1000 - at)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  return `${Math.floor(s / 3600)} h ago`
}

function Avatar({ e }: { e: Pick<TopEntry, 'name' | 'photo'> }) {
  return e.photo ? (
    <img src={e.photo} alt="" referrerPolicy="no-referrer" className="w-7 h-7 rounded-full shrink-0" />
  ) : (
    <span className="w-7 h-7 rounded-full bg-sub-alt text-text text-xs flex items-center justify-center shrink-0">{e.name.trim().charAt(0).toUpperCase() || '?'}</span>
  )
}

/** Today's top: each singer's best take of the day; open one to see and hear how they sang it. */
export function TopPage() {
  const { data, error } = useLoad<TopBoard>(analyzer.top)
  const open = (e: TopEntry) => {
    navigate('/')
    void studio.openTopTake(e.id)
  }
  return (
    <>
      <p className="lead">The best takes sung today. Tap one to open the full result and hear how they sang it.</p>
      <p>
        Each singer’s best take of the day counts — at least {Math.round((data?.minSeconds ?? 60) / 60)} minute of a song from the library,
        at normal speed and in the original key, scored the same way for everyone (normal difficulty, melody shape).
        {data && <> Starts again in {until(data.resetsAt)} (midnight, India time).</>}
      </p>
      {error && <p className="card">{error}</p>}
      {!data && !error && <p className="text-sub">loading…</p>}
      {data && data.entries.length === 0 && (
        <div className="card">
          <div className="card-title">No takes yet today</div>
          <p>Sing a song for a minute or more and yours could be the first. <a href="/" onClick={go}>Start singing</a></p>
        </div>
      )}
      {data && data.entries.length > 0 && (
        <ol className="not-prose -mx-2 sm:mx-0 border-t border-line" style={{ listStyle: 'none', padding: 0 }}>
          {data.entries.map((e) => {
            const t = tidyTitle(e.title ?? '', e.artist ?? '')
            return (
              <li key={e.id} style={{ margin: 0, padding: 0 }} className="border-b border-line">
                <button type="button" onClick={() => open(e)}
                  className={cx('group w-full flex items-center gap-3 px-2 py-2.5 text-left rounded-lg transition-colors hover:bg-sub-alt', e.mine && 'bg-sub-alt/60')}>
                  <span className={cx('w-7 text-right tabular-nums shrink-0', e.rank <= 3 ? 'text-main font-semibold' : 'text-sub')}>
                    {e.rank === 1 ? <Crown size={16} className="inline -mt-1" /> : e.rank}
                  </span>
                  <Avatar e={e} />
                  <span className="flex-1 min-w-0 leading-tight">
                    <span className="block text-text truncate">{e.name}{e.mine && <span className="text-main text-xs"> · you</span>}</span>
                    <span className="block text-xs text-sub truncate">{t.title || 'a song'}{t.artist ? ` · ${t.artist}` : ''} · {formatTime(e.seconds)} · {ago(e.at)}</span>
                  </span>
                  <span className="text-main text-lg tabular-nums font-medium shrink-0">{pct(e.score)}</span>
                  <Play size={14} className="text-sub group-hover:text-text shrink-0" />
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </>
  )
}

function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="py-4">
      <div className="text-[11px] uppercase tracking-wider text-sub">{label}</div>
      <div className="text-text text-3xl sm:text-4xl font-medium tabular-nums leading-tight mt-1">{value}</div>
      {sub && <div className="text-xs text-sub mt-0.5">{sub}</div>}
    </div>
  )
}

const num = (n: number) => n.toLocaleString('en-IN')
function hours(s: number): string {
  if (s < 3600) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(s < 36000 ? 1 : 0)} h`
}

/** Lemody in numbers. */
export function StatsPage() {
  const { data, error } = useLoad<SiteStats>(analyzer.stats, true)
  return (
    <>
      <p className="lead">Lemody in numbers, live.</p>
      {error && <p className="card">{error}</p>}
      {!data && !error && <p className="text-sub">loading…</p>}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 border-t border-line">
          <Stat label="singers" value={num(data.singers)} sub={`${num(data.singersToday)} in the last 24 h`} />
          <Stat label="tests started" value={num(data.testsStarted)} sub={`${num(data.today.testsStarted)} today`} />
          <Stat label="tests finished" value={num(data.testsFinished)} sub={`${num(data.today.testsFinished)} today`} />
          <Stat label="time sung" value={hours(data.secondsSung)} sub={`${hours(data.today.secondsSung)} today`} />
          <Stat label="songs" value={num(data.songs)} sub="in the library" />
          <Stat label="today’s top" value={num(data.inTop)} sub="of 100 places" />
        </div>
      )}
      {data && <p className="mt-6"><a href="/top" onClick={go}>See today’s top</a></p>}
    </>
  )
}
