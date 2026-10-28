import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Cpu, Loader2, Server, Smartphone } from 'lucide-react'
import { analyseOnDevice, deviceRate, deviceSupport, modelsReady, type DeviceProgress, type DeviceStage, type DeviceSupport } from '../analysis/onDevice'
import { ApiError, type AnalyzerHealth } from '../api/analyzer'
import { cx } from './ui'

const SONG_SEC = 240 // before the song is fetched its length isn't known: a typical 4-minute song

const mins = (sec: number) => `~${Math.max(1, Math.round(sec / 60))} min`

/** The two ways to analyse a new song, each with a rough time. Shown when a link isn't in Lemody yet. */
export function AnalyseChoice({ health, onDevice, onServer, onRequest, onCancel }: {
  health: AnalyzerHealth | null | undefined
  onDevice: () => void
  onServer: () => void
  /** a YouTube link: Lemody can add it for you instead (later) */
  onRequest?: () => void
  onCancel: () => void
}) {
  const [sup, setSup] = useState<DeviceSupport | null>(null)
  const [cached, setCached] = useState(true)
  useEffect(() => {
    void deviceSupport().then(setSup)
    void modelsReady().then(setCached)
  }, [])
  const ahead = health?.queue?.songs ?? 0
  const serverSec = (health?.queue?.waitSec ?? 0) + (health?.analysisRate ?? 1.4) * SONG_SEC + (health?.analysisFixedSec ?? 8)
  const deviceSec = sup ? deviceRate(sup.phone) * SONG_SEC + 30 : 0
  const serverOk = !!health?.separation // a small server may not analyse songs at all
  const pickDevice = !!sup?.ok && (!serverOk || ahead >= 3) // a long queue: this device is quicker
  const Icon = sup?.phone ? Smartphone : Cpu
  if (sup && !sup.ok && !serverOk) return <TooWeak phone={sup.phone} onRequest={onRequest} onClose={onCancel} />
  return (
    <div className="fade-in mt-4 surface rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-text">New song — where to analyse it?</span>
        <button type="button" onClick={onCancel} className="text-xs text-sub hover:text-text">cancel</button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Option
          icon={<Server size={15} />}
          title="Lemody's server"
          time={serverOk ? mins(serverSec) : '—'}
          note={!serverOk ? 'not available' : ahead ? `${ahead} song${ahead > 1 ? 's' : ''} ahead` : 'no queue'}
          recommended={serverOk && !pickDevice}
          disabled={!serverOk}
          onClick={onServer}
        />
        <Option
          icon={<Icon size={15} />}
          title={sup?.phone ? 'This phone' : 'This computer'}
          time={sup?.ok ? mins(deviceSec) : '—'}
          note={sup === null ? 'checking…' : !sup.ok ? 'not supported here' : cached ? 'keep Lemody open' : '+ 263 MB first time'}
          recommended={pickDevice}
          disabled={!sup?.ok}
          onClick={onDevice}
        />
      </div>
      {onRequest && <AskLemody onRequest={onRequest} />}
    </div>
  )
}

/** This device can't analyse songs (and there's no server to do it): say where to add it instead. */
function TooWeak({ phone, onRequest, onClose }: { phone: boolean; onRequest?: () => void; onClose: () => void }) {
  return (
    <div className="fade-in mt-4 surface rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-text">Add this song from another device</span>
        <button type="button" onClick={onClose} className="text-xs text-sub hover:text-text">close</button>
      </div>
      <p className="mt-2 text-[13px] text-sub leading-relaxed">
        {phone ? 'This phone' : 'This device'} can’t analyse new songs without slowing right down. Open Lemody on a computer
        (Chrome or Edge) or a newer phone and add it there — then it’s here for you to sing on any device.
      </p>
      {onRequest && <AskLemody onRequest={onRequest} />}
    </div>
  )
}

/** "We'll do it for you": the song is added by hand, within a week, and lands in your songs. */
export function AskLemody({ onRequest }: { onRequest: () => void }) {
  return (
    <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2">
      <span className="text-[12px] text-sub">Rather not wait here? We’ll add it for you within a week.</span>
      <button type="button" onClick={onRequest} className="rounded-full bg-main/15 text-main text-xs font-medium px-3 py-1.5 hover:bg-main/25">
        ask Lemody to add it
      </button>
    </div>
  )
}

function Option({ icon, title, time, note, recommended, disabled, onClick }: {
  icon: React.ReactNode; title: string; time: string; note: string; recommended: boolean; disabled: boolean; onClick: () => void
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={cx('relative text-left rounded-xl border p-3 transition-colors disabled:opacity-45',
        recommended ? 'border-main/70 bg-main/8' : 'border-line bg-bg/60 hover:border-main/50')}>
      {recommended && <span className="absolute -top-2 right-3 rounded-full bg-main text-bg text-[10px] font-semibold px-2 py-0.5">recommended</span>}
      <div className="flex items-center gap-2 text-sm font-medium text-text">
        <span className="text-main">{icon}</span>{title}
        <span className="ml-auto tabular-nums text-text">{time}</span>
      </div>
      <div className="mt-1 text-[11px] text-sub">{note}</div>
    </button>
  )
}

const STEPS: { id: DeviceStage[]; label: string }[] = [
  { id: ['models'], label: 'get analyser' },
  { id: ['fetching'], label: 'get song' },
  { id: ['separating'], label: 'separate vocals' },
  { id: ['melody'], label: 'find melody' },
  { id: ['encoding', 'uploading'], label: 'upload' },
  { id: ['checking', 'finishing'], label: 'check & finish' },
]

const ORDER: DeviceStage[] = ['models', 'fetching', 'separating', 'melody', 'encoding', 'uploading', 'checking', 'finishing']

function timeLeft(sec: number): string {
  if (sec < 40) return 'almost done'
  if (sec < 90) return 'about a minute left'
  return `about ${Math.round(sec / 60)} min left`
}

/**
 * Runs the analysis on this device, with the same progress card as the server's —
 * and keeps the screen awake, warns before the page is closed, and offers the
 * server if this device turns out slow or fails.
 */
export function DeviceRun({ url, serverSec, onDone, onUseServer, onRequest, onCancel }: {
  /** a YouTube link, or the singer's own audio file */
  url: string | File
  /** how long the server would take (for the "this device is slow" hint) */
  serverSec: number
  onDone: (id: string) => void
  /** undefined when the server doesn't analyse songs */
  onUseServer?: () => void
  /** a YouTube link: Lemody can add it for you instead */
  onRequest?: () => void
  onCancel: () => void
}) {
  const [p, setP] = useState<DeviceProgress>({ stage: 'models', progress: 0, detail: 'starting', eta: null })
  const [err, setErr] = useState<string | null>(null)
  const ctl = useRef<AbortController | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    ctl.current = ac
    let lock: { release(): Promise<void> } | null = null
    const wake = () => {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
      void wl?.request('screen').then((l) => (lock = l)).catch(() => {})
    }
    wake()
    const onVisible = () => document.visibilityState === 'visible' && wake() // the lock drops when the tab is hidden
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('beforeunload', onLeave)
    analyseOnDevice(url, setP, ac.signal).then(
      (r) => (r.kind !== 'server' ? onDone(r.id) : onUseServer ? onUseServer() : setErr('This browser can\u2019t analyse songs. Try Chrome or Edge on a computer.')),
      (e) => {
        if ((e as Error).name === 'AbortError') return
        setErr(e instanceof ApiError && e.code === 'rejected' ? `The result didn't pass Lemody's checks: ${e.message}` : (e as Error).message)
      },
    )
    return () => {
      ac.abort()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('beforeunload', onLeave)
      void lock?.release().catch(() => {})
    }
    // runs once per song
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

  const at = ORDER.indexOf(p.stage)
  const stepIdx = STEPS.findIndex((s) => s.id.includes(p.stage))
  const slow = !err && p.eta !== null && (p.stage === 'separating' || p.stage === 'melody') && p.eta > serverSec * 1.6 + 60
  return (
    <div className="mt-6 fade-in">
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="text-text truncate">{p.title ?? 'analysing on this device'}</span>
        {!err && (
          <button type="button" className="text-sub hover:text-error" onClick={() => { ctl.current?.abort(); onCancel() }}>cancel</button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {STEPS.map((st, i) => (
          <span key={st.label} className={cx('flex items-center gap-1', i < stepIdx ? 'text-text' : i === stepIdx ? (err ? 'text-error' : 'text-main') : 'text-sub')}>
            {i < stepIdx ? <Check size={12} /> : i === stepIdx && !err ? <Loader2 size={12} className="animate-spin" /> : null}
            {st.label}
          </span>
        ))}
      </div>
      <div className="h-1 bg-sub-alt rounded-full mt-3 overflow-hidden">
        <div className={cx('h-full rounded-full transition-[width] duration-500 ease-out', err ? 'bg-error' : 'bg-main')} style={{ width: `${Math.round(p.progress * 100)}%` }} />
      </div>
      <div className="flex items-baseline justify-between gap-3 text-xs mt-2">
        <span className="text-sub truncate">{err ? 'stopped' : p.detail}</span>
        {!err && (
          <span className="shrink-0 tabular-nums">
            <span className="text-text font-medium">{Math.round(p.progress * 100)}%</span>
            {p.eta !== null && at >= ORDER.indexOf('separating') && <span className="text-sub"> · {timeLeft(p.eta)}</span>}
          </span>
        )}
      </div>

      {err ? (
        <div role="alert" className="mt-4 rounded-xl border border-error/30 bg-error/8 p-3.5">
          <div className="flex gap-2 text-[13px] text-text"><AlertTriangle size={15} className="text-error shrink-0 mt-0.5" />{err}</div>
          <div className="mt-3 flex gap-2">
            {onUseServer && <button type="button" onClick={onUseServer} className="rounded-full bg-main text-bg text-xs font-medium px-4 py-1.5">use Lemody's server instead</button>}
            <button type="button" onClick={onCancel} className="rounded-full surface text-xs px-4 py-1.5 text-sub hover:text-text">close</button>
          </div>
          {onRequest && <AskLemody onRequest={onRequest} />}
        </div>
      ) : (
        <div className="mt-3 text-[12px] text-main">Keep Lemody open until it's done.</div>
      )}
      {slow && onUseServer && (
        <div className="mt-2.5 text-[12px] text-sub leading-relaxed fade-in">
          Server would be faster ({mins(serverSec)}).{' '}
          <button type="button" className="text-main hover:underline" onClick={() => { ctl.current?.abort(); onUseServer() }}>switch</button>
        </div>
      )}
    </div>
  )
}
