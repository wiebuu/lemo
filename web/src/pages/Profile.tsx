import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { analyzer, localDay, type ActivityDay, type HistoryTest, type MyProfile, type ProfileTotals, type PublicProfile } from '../api/analyzer'
import { signInWithGoogle, useAuth } from '../auth/firebase'
import { METRIC_LABELS } from '../lib/evaluation'
import { tidyTitle } from '../lib/titles'
import { studio } from '../state/studio'
import { cx, InfoTip, Pager, Tip, usePaged } from '../components/ui'
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
const shortDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const longDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

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

/** A section's small heading, with an optional note on the right. */
function Label({ children, note }: { children: string; note?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-2">
      <span className="uppercase tracking-wider text-[9.5px] sm:text-[11px] text-sub">{children}</span>
      {note && <span className="text-[10.5px] sm:text-xs text-sub truncate">{note}</span>}
    </div>
  )
}

function Avatar({ name, photo }: { name: string; photo: string | null }) {
  const cls = 'w-10 h-10 sm:w-14 sm:h-14 text-base sm:text-xl rounded-full shrink-0'
  return photo ? (
    <img src={photo} alt="" referrerPolicy="no-referrer" className={cls} />
  ) : (
    <span className={cx(cls, 'bg-sub-alt text-text flex items-center justify-center')}>{name.charAt(0).toUpperCase() || '?'}</span>
  )
}

function Header({ who, joined, children }: { who: { username: string; photo: string | null }; joined: number | null; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <Avatar name={who.username} photo={who.photo} />
      <div className="min-w-0 flex-1">
        {children ?? <div className="text-lg sm:text-2xl font-semibold text-text tracking-tight truncate">{who.username}</div>}
        {joined && <div className="text-[11px] sm:text-xs text-sub">joined {longDate(new Date(joined * 1000))}</div>}
      </div>
    </div>
  )
}

/** Tests started and completed, time singing, averages and the streak (the same for everyone who looks). */
function Totals({ t, days }: { t: ProfileTotals; days: ActivityDay[] }) {
  const n = streak(days)
  const stats: [string, string][] = [
    ['tests started', num(t.testsStarted)],
    ['tests completed', num(t.testsFinished)],
    // tests from before time was kept count none, so no time at all is a dash, not "0 s"
    ['time singing', t.seconds > 0 ? spent(t.seconds) : '–'],
    ['average score', pct(t.average)],
    ['last 10 average', pct(t.last10)],
    ['streak', `${n} ${n === 1 ? 'day' : 'days'}`],
  ]
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-x-3 sm:gap-x-5 border-t border-line mt-4 sm:mt-5">
      {stats.map(([label, value]) => (
        <div key={label} className="py-2 sm:py-3 min-w-0">
          <div className="text-[9px] sm:text-[10.5px] uppercase tracking-wider text-sub truncate">{label}</div>
          <div className="text-text text-[15px] sm:text-xl font-medium tabular-nums leading-tight mt-0.5 truncate">{value}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * The last year, a square per day, brighter the longer you sang that day. Tap or hover a
 * day for its numbers. Fills the width on a big screen; scrolls on a phone (latest first).
 */
function ActivityCalendar({ days }: { days: ActivityDay[] }) {
  const by = useMemo(() => new Map(days.map((d) => [d.day, d])), [days])
  const [picked, setPicked] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // 53 weeks, Sunday first, ending today
  const cells = useMemo(() => {
    const end = new Date()
    const d = new Date(end)
    d.setDate(d.getDate() - d.getDay() - 52 * 7)
    const out: string[] = []
    for (; d <= end; d.setDate(d.getDate() + 1)) out.push(localDay(d))
    return out
  }, [])
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const end = () => (el.scrollLeft = el.scrollWidth)
    end()
    const ro = new ResizeObserver(end)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild) // the grid itself changes width with the screen
    const stop = () => ro.disconnect()
    el.addEventListener('pointerdown', stop, { once: true }) // once you scroll it yourself, it's yours
    return stop
  }, [])
  const active = days.filter((d) => d.seconds > 0 || d.tests > 0).length
  // by time sung; a day with no time known (tests from before it was kept) by its number of tests
  const level = (d?: ActivityDay) =>
    !d ? 0 : d.seconds <= 0 ? (d.tests <= 0 ? 0 : d.tests < 3 ? 1 : d.tests < 6 ? 2 : d.tests < 11 ? 3 : 4) : d.seconds < 5 * 60 ? 1 : d.seconds < 15 * 60 ? 2 : d.seconds < 40 * 60 ? 3 : 4
  const shade = ['bg-sub-alt', 'bg-main/35', 'bg-main/55', 'bg-main/80', 'bg-main']
  const p = picked ? by.get(picked) : null
  return (
    <section className="mt-5 sm:mt-7">
      <Label note={`${active} ${active === 1 ? 'day' : 'days'} singing in the last year`}>activity</Label>
      <div ref={scroller} className="overflow-x-auto md:overflow-visible pb-1" onMouseLeave={() => setPicked(null)}>
        <div className="grid grid-rows-7 grid-flow-col auto-cols-[9px] md:auto-cols-fr gap-[2px] md:gap-[3px] w-max md:w-full">
          {cells.map((day) => (
            <button
              key={day}
              type="button"
              aria-label={day}
              onMouseEnter={() => setPicked(day)}
              onClick={() => setPicked(day)}
              className={cx('aspect-square w-full rounded-[2px] md:rounded-[3px]', shade[level(by.get(day))], picked === day && 'ring-1 ring-text')}
            />
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] sm:text-[11px] text-sub min-h-4">
        <span className="truncate">
          {picked
            ? `${dateOf(picked).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${p ? `${p.seconds > 0 ? `${spent(p.seconds)} · ` : ''}${p.tests} ${p.tests === 1 ? 'test' : 'tests'}` : 'no singing'}`
            : ''}
        </span>
        <span className="flex items-center gap-[3px] shrink-0">
          less
          {shade.map((c) => (
            <span key={c} className={cx('w-2 h-2 rounded-[2px]', c)} />
          ))}
          more
        </span>
      </div>
    </section>
  )
}

/**
 * Every scored test, oldest on the left: a dot per test, the running average of the last
 * 10 as a smooth line, your overall average dashed. Hover or tap for the test.
 */
function ScoreChart({ history }: { history: HistoryTest[] }) {
  const pts = useMemo(() => history.filter((h) => h.score != null).slice(0, 300).reverse(), [history])
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  const [at, setAt] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    // a tap anywhere off the chart puts its details away (phones have no "mouse left")
    const away = (e: PointerEvent) => !el.contains(e.target as Node) && setAt(null)
    window.addEventListener('pointerdown', away, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('pointerdown', away, true)
    }
  }, [])
  if (pts.length < 2) return null
  const phone = w < 500
  const H = phone ? 150 : 210
  const L = 26 // room for the score labels
  const R = 6
  const T = 8
  const B = 18 // room for the dates
  const x = (i: number) => L + (i / (pts.length - 1)) * (w - L - R)
  const y = (v: number) => T + (1 - v) * (H - T - B)
  const scores = pts.map((h) => h.score!)
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  const run = scores.map((_, i) => {
    const s = scores.slice(Math.max(0, i - 9), i + 1)
    return s.reduce((a, b) => a + b, 0) / s.length
  })
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const dates = [0, Math.floor((pts.length - 1) / 2), pts.length - 1]
  const pick = (clientX: number) => {
    const r = box.current!.getBoundingClientRect()
    const i = Math.round(((clientX - r.left - L) / (w - L - R)) * (pts.length - 1))
    setAt(Math.max(0, Math.min(pts.length - 1, i)))
  }
  const h = at !== null ? pts[at] : null
  const t = h ? tidyTitle(h.title ?? '', h.artist ?? '') : null
  const dot = pts.length > 120 ? 1.5 : 2.2
  return (
    <section className="mt-5 sm:mt-7">
      <Label
        note={
          <span className="flex items-center gap-2.5">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sub" />test</span>
            <span className="flex items-center gap-1"><span className="w-3 h-[2px] rounded bg-main" />last 10</span>
            <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-sub" />average</span>
          </span>
        }
      >
        score, test by test
      </Label>
      <div
        ref={box}
        className="relative touch-pan-y select-none"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setAt(null)}
      >
        <svg width={w} height={H} className="block overflow-visible">
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <g key={g}>
              <line x1={L} x2={w - R} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={1} />
              <text x={L - 6} y={y(g) + 3} textAnchor="end" fontSize={9} fill="var(--sub)">{g * 100}</text>
            </g>
          ))}
          {dates.map((i, k) => (
            <text key={k} x={x(i)} y={H - 4} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'} fontSize={9} fill="var(--sub)">
              {shortDate(dateOf(pts[i].day))}
            </text>
          ))}
          <line x1={L} x2={w - R} y1={y(avg)} y2={y(avg)} stroke="var(--sub)" strokeWidth={1} strokeDasharray="3 3" />
          <path d={path(scores)} fill="none" stroke="var(--sub)" strokeOpacity={0.35} strokeWidth={1} />
          {scores.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={dot} fill="var(--sub)" fillOpacity={0.8} />
          ))}
          <path d={path(run)} fill="none" stroke="var(--main)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {at !== null && (
            <>
              <line x1={x(at)} x2={x(at)} y1={T} y2={H - B} stroke="var(--sub)" strokeOpacity={0.5} strokeWidth={1} />
              <circle cx={x(at)} cy={y(scores[at])} r={4} fill="var(--main)" stroke="var(--bg)" strokeWidth={2} />
            </>
          )}
        </svg>
        {h && t && (
          <div
            className="absolute top-0 pointer-events-none rounded-lg surface shadow-lg px-2.5 py-1.5 text-[10.5px] sm:text-xs leading-snug max-w-[11rem] sm:max-w-[14rem]"
            style={x(at!) > w / 2 ? { right: w - x(at!) + 8 } : { left: x(at!) + 8 }}
          >
            <div className="text-text font-medium tabular-nums">{pct(h.score)}</div>
            <div className="text-text truncate">{t.title || 'a song'}</div>
            <div className="text-sub">
              {longDate(dateOf(h.day))}
              {h.seconds > 0 && ` · ${clock(h.seconds)}`} · test {at! + 1} of {pts.length}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/** Every finished test, newest first: the song, the score, how long, when. */
function History({ history }: { history: HistoryTest[] }) {
  const page = usePaged(history)
  const cols = 'grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_auto_auto_auto] gap-x-3 sm:gap-x-6'
  return (
    <section className="mt-5 sm:mt-7">
      <Label>history</Label>
      {history.length === 0 ? (
        <p className="text-xs sm:text-sm text-sub">
          No finished tests yet.{' '}
          <a href="/" onClick={go} className="text-main">Sing a song</a>{' '}
          — every test you finish shows up here.
        </p>
      ) : (
        <>
          <div className={cx(cols, 'text-[9px] sm:text-[10px] uppercase tracking-wider text-sub px-2 pb-1')}>
            <span>song</span>
            <span className="text-right">score</span>
            <span className="text-right hidden sm:block">sung</span>
            <span className="text-right">date</span>
          </div>
          <ol className="flex flex-col" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {page.items.map((h) => {
              const t = tidyTitle(h.title ?? '', h.artist ?? '')
              const open = h.songId ? () => { navigate('/'); void studio.loadAnalyzed(h.songId!) } : undefined
              const parts = Object.entries(h.scores ?? {}).filter(([k, v]) => k !== 'overall' && v != null && k in METRIC_LABELS) as [MetricKey, number][]
              return (
                <li key={h.id} className={cx(cols, 'items-center rounded-lg px-2 py-1 sm:py-1.5 hover:bg-sub-alt text-xs sm:text-sm')}>
                  <button type="button" onClick={open} disabled={!open} className="min-w-0 text-left disabled:cursor-default">
                    <div className="truncate text-text">{t.title || 'a song'}</div>
                    {t.artist && <div className="truncate text-[10px] sm:text-[11px] text-sub">{t.artist}</div>}
                  </button>
                  <Tip tip={parts.length ? <div className="flex flex-col gap-0.5">{parts.map(([k, v]) => <span key={k}>{METRIC_LABELS[k]}: {pct(v)}</span>)}</div> : 'Overall score'}>
                    <span className="text-right tabular-nums text-text">{pct(h.score)}</span>
                  </Tip>
                  <span className="text-right tabular-nums text-sub hidden sm:block">{h.seconds > 0 ? clock(h.seconds) : '–'}</span>
                  <span className="text-right tabular-nums text-sub text-[10.5px] sm:text-xs whitespace-nowrap">
                    {shortDate(dateOf(h.day))}
                    <span className="hidden sm:inline"> {new Date(h.at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
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
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-lg sm:text-2xl font-semibold text-text tracking-tight truncate">{name}</span>
        <Tip tip="Change your username">
          <button type="button" onClick={() => { setText(name); setEditing(true) }} aria-label="change username" className="text-sub hover:text-text p-1">
            <Pencil size={13} />
          </button>
        </Tip>
      </div>
    )
  return (
    <div>
      <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <input
          autoFocus
          value={text}
          maxLength={20}
          onChange={(e) => { setText(e.target.value); setError(null) }}
          spellCheck={false}
          autoCapitalize="none"
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(false))}
          className="min-w-0 w-40 sm:w-56 bg-sub-alt rounded-md px-2 py-0.5 text-base sm:text-lg font-semibold text-text outline-none focus:ring-1 focus:ring-main"
          aria-label="new username"
        />
        <button type="submit" disabled={saving} aria-label="save" className="p-1 rounded-full text-main hover:bg-sub-alt"><Check size={15} /></button>
        <button type="button" onClick={() => setEditing(false)} aria-label="cancel" className="p-1 rounded-full text-sub hover:text-text hover:bg-sub-alt"><X size={15} /></button>
      </form>
      <div className={cx('text-[10.5px] mt-0.5', error ? 'text-error' : 'text-sub')}>{error ?? '3–20 letters, numbers, . _ or -'}</div>
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
    analyzer.profile().then((d) => live && setData(d), (e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [signedIn])
  return (
    <>
      {auth.status === 'loading' && <Loading error={null} />}
      {auth.status === 'signed-out' && (
        <div className="card">
          <div className="card-title">Your profile</div>
          <p>Sign in to see the days you sang, your time singing and every test you've finished.</p>
          <button type="button" onClick={() => void signInWithGoogle()} className="mt-2 rounded-full bg-main text-bg text-sm font-medium px-4 py-1.5">sign in</button>
        </div>
      )}
      {signedIn && !data && <Loading error={error} />}
      {data && <ProfileView data={data} onChange={setData} />}
    </>
  )
}

/** A signed-in singer's own profile, once loaded. */
export function ProfileView({ data, onChange }: { data: MyProfile; onChange: (d: MyProfile) => void }) {
  return (
    <div className="not-prose">
      <Header who={{ username: data.username, photo: data.photo }} joined={data.joined}>
        <Username name={data.username} onChange={(username) => onChange({ ...data, username })} />
      </Header>
      <Totals t={data} days={data.days} />
      <ActivityCalendar days={data.days} />
      <ScoreChart history={data.history} />
      <History history={data.history} />
      <div className="mt-5 flex items-center gap-1 text-[11px] sm:text-xs text-sub">
        <a href={`/u/${data.username}`} onClick={go} className="text-main">your public profile</a>
        <InfoTip>Others see your name, picture, numbers and activity: never which songs you sang, nor your voice.</InfoTip>
      </div>
    </div>
  )
}

/** Someone's profile, as anyone sees it: name, picture, when they joined, their numbers and the days they sang. */
export function UserPage({ username }: { username: string }) {
  const [data, setData] = useState<PublicProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    analyzer.user(username).then((d) => live && setData(d), (e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [username])
  if (!data) return <Loading error={error} />
  return (
    <div className="not-prose">
      <Header who={data} joined={data.joined} />
      <Totals t={data} days={data.days} />
      <ActivityCalendar days={data.days} />
    </div>
  )
}
