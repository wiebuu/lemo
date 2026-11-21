import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Pencil, Search, X } from 'lucide-react'
import { analyzer, localDay, type ActivityDay, type HistoryTest, type MyProfile, type PublicProfile } from '../api/analyzer'
import { signInWithGoogle, useAuth } from '../auth/firebase'
import { METRIC_LABELS } from '../lib/evaluation'
import { tidyTitle } from '../lib/titles'
import { studio } from '../state/studio'
import { cx, Pager, Tip, usePaged } from '../components/ui'
import type { MetricKey } from '../lib/types'
import { go, navigate } from './router'

const pct = (v: number | null | undefined) => (v == null ? '–' : `${(v * 100).toFixed(2)}%`)
const num = (n: number) => n.toLocaleString('en-IN')

/** 2 h 05 min · 14 min · 40 s */
function spent(s: number): string {
  if (s < 60) return `${Math.round(s)} s`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const dateOf = (day: string) => new Date(`${day}T12:00:00`)
const longDate = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

/** Days in a row you sang, up to today (or yesterday, while today is still ahead of you). */
function streak(days: ActivityDay[]): number {
  const sang = new Set(days.filter((d) => d.tests > 0 || d.seconds > 0).map((d) => d.day))
  const d = new Date()
  if (!sang.has(localDay(d))) d.setDate(d.getDate() - 1)
  let n = 0
  while (sang.has(localDay(d))) {
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}

function Avatar({ name, photo, size = 'lg' }: { name: string; photo: string | null; size?: 'lg' | 'sm' }) {
  const cls = size === 'lg' ? 'w-14 h-14 sm:w-16 sm:h-16 text-xl' : 'w-6 h-6 text-[11px]'
  return photo ? (
    <img src={photo} alt="" referrerPolicy="no-referrer" className={cx(cls, 'rounded-full shrink-0')} />
  ) : (
    <span className={cx(cls, 'rounded-full bg-sub-alt text-text flex items-center justify-center shrink-0')}>{name.charAt(0).toUpperCase() || '?'}</span>
  )
}

function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="py-2.5 sm:py-4">
      <div className="text-[9.5px] sm:text-[11px] uppercase tracking-wider text-sub">{label}</div>
      <div className="text-text text-xl sm:text-3xl font-medium tabular-nums leading-tight mt-0.5 sm:mt-1">{value}</div>
      {sub && <div className="text-[10.5px] sm:text-xs text-sub mt-0.5">{sub}</div>}
    </div>
  )
}

/** Find a singer by name; their profile opens on picking one. */
function UserSearch() {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ username: string; photo: string | null }[] | null>(null)
  useEffect(() => {
    const t = q.trim()
    if (!t) return setFound(null)
    let live = true
    const timer = setTimeout(
      () =>
        analyzer.findUsers(t).then(
          (r) => live && setFound(r),
          () => live && setFound([]),
        ),
      200,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q])
  return (
    <div className="not-prose relative">
      <label className="flex items-center gap-2 rounded-full surface px-3 py-1.5 text-xs text-sub focus-within:text-text">
        <Search size={13} className="shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="find a singer"
          spellCheck={false}
          autoCapitalize="none"
          className="bg-transparent outline-none flex-1 min-w-0 text-text placeholder:text-sub"
          aria-label="find a singer"
        />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="clear">
            <X size={12} />
          </button>
        )}
      </label>
      {found && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-2xl surface shadow-lg p-1 text-sm">
          {found.length === 0 && <div className="px-3 py-2 text-xs text-sub">no singer by that name</div>}
          {found.map((u) => (
            <a
              key={u.username}
              href={`/u/${u.username}`}
              onClick={(e) => {
                setQ('')
                go(e)
              }}
              className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-text no-underline hover:bg-sub-alt"
            >
              <Avatar name={u.username} photo={u.photo} size="sm" />
              {u.username}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

/** The last year, a square per day, brighter the longer you sang that day. Tap or hover a day for its numbers. */
function ActivityCalendar({ days }: { days: ActivityDay[] }) {
  const by = useMemo(() => new Map(days.map((d) => [d.day, d])), [days])
  const [picked, setPicked] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // 53 weeks, Sunday first, ending with this week
  const weeks = useMemo(() => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - start.getDay() - 52 * 7)
    const out: string[][] = []
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0) out.push([])
      out[out.length - 1].push(localDay(d))
    }
    return out
  }, [])
  useEffect(() => {
    // the latest weeks first, on a narrow screen (kept there while the page settles in)
    const el = scroller.current
    if (!el) return
    const end = () => (el.scrollLeft = el.scrollWidth)
    end()
    const ro = new ResizeObserver(end)
    ro.observe(el)
    const stop = () => ro.disconnect()
    el.addEventListener('pointerdown', stop, { once: true }) // once you scroll it yourself, it's yours
    return stop
  }, [])
  const active = days.filter((d) => d.seconds > 0 || d.tests > 0).length
  // by time sung; a day with no time known (tests from before it was kept) by its number of tests
  const level = (d?: ActivityDay) => (!d ? 0 : d.seconds <= 0 ? (d.tests <= 0 ? 0 : d.tests < 3 ? 1 : d.tests < 6 ? 2 : d.tests < 11 ? 3 : 4) : d.seconds < 5 * 60 ? 1 : d.seconds < 15 * 60 ? 2 : d.seconds < 40 * 60 ? 3 : 4)
  const shade = ['bg-sub-alt', 'bg-main/35', 'bg-main/55', 'bg-main/80', 'bg-main']
  const p = picked ? by.get(picked) : null
  return (
    <section className="not-prose mt-6 sm:mt-8">
      <div className="flex items-baseline justify-between text-xs text-sub mb-2">
        <span className="uppercase tracking-wider text-[10px] sm:text-[11px]">activity</span>
        <span>
          {active} {active === 1 ? 'day' : 'days'} singing in the last year
        </span>
      </div>
      <div ref={scroller} className="overflow-x-auto pb-1" onMouseLeave={() => setPicked(null)}>
        <div className="flex gap-[3px] w-max mx-auto">
          {weeks.map((w, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {w.map((day) => {
                const d = by.get(day)
                return (
                  <button
                    key={day}
                    type="button"
                    aria-label={day}
                    onMouseEnter={() => setPicked(day)}
                    onClick={() => setPicked(day)}
                    className={cx('w-[10px] h-[10px] sm:w-[11px] sm:h-[11px] rounded-[3px]', shade[level(d)], picked === day && 'ring-1 ring-text')}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-sub h-4">
        <span>
          {picked
            ? `${dateOf(picked).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${p ? `${spent(p.seconds)} singing · ${p.tests} ${p.tests === 1 ? 'test' : 'tests'}` : 'no singing'}`
            : ''}
        </span>
        <span className="flex items-center gap-1">
          less{' '}
          {shade.map((c) => (
            <span key={c} className={cx('w-[9px] h-[9px] rounded-[2px]', c)} />
          ))}{' '}
          more
        </span>
      </div>
    </section>
  )
}

/** Your scores, test by test (the last 100), oldest on the left. */
function ScoreChart({ history }: { history: HistoryTest[] }) {
  const pts = history
    .filter((h) => h.score != null)
    .slice(0, 100)
    .reverse()
  if (pts.length < 2) return null
  const W = 600
  const H = 120
  const x = (i: number) => (i / (pts.length - 1)) * W
  const y = (v: number) => H - v * H
  const line = pts.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(h.score!).toFixed(1)}`).join('')
  return (
    <section className="not-prose mt-6 sm:mt-8">
      <div className="uppercase tracking-wider text-[10px] sm:text-[11px] text-sub mb-2">score, test by test</div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-24 sm:h-32 overflow-visible">
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={line} fill="none" stroke="var(--main)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="absolute inset-y-0 -left-0.5 flex flex-col justify-between text-[9px] text-sub pointer-events-none -translate-x-full pr-1 hidden sm:flex">
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
      </div>
    </section>
  )
}

/** Every finished test, newest first: the song, the score, how long, when. */
function History({ history }: { history: HistoryTest[] }) {
  const page = usePaged(history)
  return (
    <section className="not-prose mt-6 sm:mt-8">
      <div className="uppercase tracking-wider text-[10px] sm:text-[11px] text-sub mb-2">history</div>
      {history.length === 0 ? (
        <p className="text-sm text-sub">
          No finished tests yet.{' '}
          <a href="/" onClick={go} className="text-main">
            Sing a song
          </a>{' '}
          — every test you finish shows up here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_auto_auto_auto] gap-x-4 sm:gap-x-6 text-[10px] uppercase tracking-wider text-sub px-2 pb-1.5">
            <span>song</span>
            <span className="text-right">score</span>
            <span className="text-right hidden sm:block">sung</span>
            <span className="text-right">date</span>
          </div>
          <ol className="flex flex-col gap-0.5" style={{ listStyle: 'none', padding: 0 }}>
            {page.items.map((h) => {
              const t = tidyTitle(h.title ?? '', h.artist ?? '')
              const open = h.songId
                ? () => {
                    navigate('/')
                    void studio.loadAnalyzed(h.songId!)
                  }
                : undefined
              const parts = Object.entries(h.scores ?? {}).filter(([k, v]) => k !== 'overall' && v != null && k in METRIC_LABELS) as [MetricKey, number][]
              return (
                <li
                  key={h.id}
                  className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_auto_auto_auto] gap-x-4 sm:gap-x-6 items-center rounded-xl px-2 py-1.5 hover:bg-sub-alt text-sm"
                >
                  <button type="button" onClick={open} disabled={!open} className="min-w-0 text-left disabled:cursor-default">
                    <div className="truncate text-text">{t.title || 'a song'}</div>
                    {t.artist && <div className="truncate text-[11px] text-sub">{t.artist}</div>}
                  </button>
                  <Tip
                    tip={
                      parts.length ? (
                        <div className="flex flex-col gap-0.5">
                          {parts.map(([k, v]) => (
                            <span key={k}>
                              {METRIC_LABELS[k]}: {pct(v)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        'Overall score'
                      )
                    }
                  >
                    <span className="text-right tabular-nums text-text">{pct(h.score)}</span>
                  </Tip>
                  <span className="text-right tabular-nums text-sub hidden sm:block">{h.seconds > 0 ? clock(h.seconds) : '–'}</span>
                  <span className="text-right tabular-nums text-sub text-xs whitespace-nowrap">
                    {dateOf(h.day).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })}
                    <span className="hidden sm:inline">
                      {' '}
                      {new Date(h.at * 1000).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>
          <Pager at={page.at} pages={page.pages} onPage={page.go} />
        </>
      )}
    </section>
  )
}

/** Your username, with a pencil to change it (saved when you press enter or ✓). */
function Username({ name, onChange }: { name: string; onChange: (n: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    const t = text.trim()
    if (t === name) return setEditing(false)
    setSaving(true)
    try {
      const r = await analyzer.setUsername(t)
      onChange(r.username)
      setEditing(false)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  if (!editing)
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-2xl sm:text-3xl font-semibold text-text tracking-tight truncate">{name}</span>
        <Tip tip="Change your username">
          <button
            type="button"
            onClick={() => {
              setText(name)
              setEditing(true)
            }}
            aria-label="change username"
            className="text-sub hover:text-text p-1"
          >
            <Pencil size={14} />
          </button>
        </Tip>
      </div>
    )
  return (
    <div>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <input
          autoFocus
          value={text}
          maxLength={20}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          spellCheck={false}
          autoCapitalize="none"
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(false))}
          className="min-w-0 w-48 sm:w-60 bg-sub-alt rounded-lg px-2.5 py-1 text-lg sm:text-xl font-semibold text-text outline-none focus:ring-1 focus:ring-main"
          aria-label="new username"
        />
        <button type="submit" disabled={saving} aria-label="save" className="p-1.5 rounded-full text-main hover:bg-sub-alt">
          <Check size={16} />
        </button>
        <button type="button" onClick={() => setEditing(false)} aria-label="cancel" className="p-1.5 rounded-full text-sub hover:text-text hover:bg-sub-alt">
          <X size={16} />
        </button>
      </form>
      <div className={cx('text-[11px] mt-1', error ? 'text-error' : 'text-sub')}>{error ?? '3–20 letters, numbers, . _ or -'}</div>
    </div>
  )
}

function Header({ who, joined, children }: { who: { username: string; photo: string | null }; joined: number | null; children?: React.ReactNode }) {
  return (
    <div className="not-prose flex items-center gap-3 sm:gap-4">
      <Avatar name={who.username} photo={who.photo} />
      <div className="min-w-0 flex-1">
        {children ?? <div className="text-2xl sm:text-3xl font-semibold text-text tracking-tight truncate">{who.username}</div>}
        {joined && <div className="text-xs text-sub mt-0.5">joined {longDate(new Date(joined * 1000))}</div>}
      </div>
    </div>
  )
}

function Loading({ error }: { error: string | null }) {
  return error ? <p className="card">{error}</p> : <p className="text-sub">loading…</p>
}

/** Your profile: who you are on Lemody, how much you've sung, the days you sang, and every test. */
export function ProfilePage() {
  const auth = useAuth()
  const [data, setData] = useState<MyProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const signedIn = auth.status === 'signed-in'
  useEffect(() => {
    if (!signedIn) return
    let live = true
    analyzer.profile().then(
      (d) => live && setData(d),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [signedIn])

  return (
    <>
      <div className="mb-6">
        <UserSearch />
      </div>
      {auth.status === 'loading' && <Loading error={null} />}
      {auth.status === 'signed-out' && (
        <div className="card">
          <div className="card-title">Your profile</div>
          <p>Sign in to see the days you sang, your time singing and every test you've finished.</p>
          <button type="button" onClick={() => void signInWithGoogle()} className="mt-2 rounded-full bg-main text-bg text-sm font-medium px-4 py-1.5">
            sign in
          </button>
        </div>
      )}
      {signedIn && !data && <Loading error={error} />}
      {data && <ProfileView data={data} onChange={setData} />}
    </>
  )
}

/** A signed-in singer's own profile, once loaded. */
export function ProfileView({ data, onChange }: { data: MyProfile; onChange: (d: MyProfile) => void }) {
  const last10 = useMemo(() => {
    const s = data.history
      .slice(0, 10)
      .map((h) => h.score)
      .filter((v): v is number => v != null)
    return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null
  }, [data])
  const days = streak(data.days)
  return (
    <>
      <Header who={{ username: data.username, photo: data.photo }} joined={data.joined}>
        <Username name={data.username} onChange={(username) => onChange({ ...data, username })} />
      </Header>
      <div className="not-prose grid grid-cols-3 gap-x-4 sm:gap-x-6 border-t border-line mt-5">
        <Stat label="tests started" value={num(data.testsStarted)} />
        <Stat label="tests completed" value={num(data.testsFinished)} />
        <Stat label="time singing" value={spent(data.seconds)} />
        <Stat label="average score" value={pct(data.average)} />
        <Stat label="last 10 average" value={pct(last10)} />
        <Stat label="streak" value={`${days} ${days === 1 ? 'day' : 'days'}`} />
      </div>
      <ActivityCalendar days={data.days} />
      <ScoreChart history={data.history} />
      <History history={data.history} />
      <p className="not-prose mt-6 text-xs text-sub">
        Others see only your name, picture and activity:{' '}
        <a href={`/u/${data.username}`} onClick={go} className="text-main">
          your public profile
        </a>
        .
      </p>
    </>
  )
}

/** Someone's profile, as anyone sees it: name, picture, when they joined and the days they sang. */
export function UserPage({ username }: { username: string }) {
  const [data, setData] = useState<PublicProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    analyzer.user(username).then(
      (d) => live && setData(d),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [username])
  const total = data?.days.reduce((a, d) => a + d.seconds, 0) ?? 0
  return (
    <>
      <div className="mb-6">
        <UserSearch />
      </div>
      {!data && <Loading error={error} />}
      {data && (
        <>
          <Header who={data} joined={data.joined} />
          {total > 0 && <div className="not-prose text-xs text-sub mt-4">{spent(total)} singing in the last year</div>}
          <ActivityCalendar days={data.days} />
        </>
      )}
    </>
  )
}
