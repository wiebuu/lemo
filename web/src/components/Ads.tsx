import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { AD_CLIENT, AD_SLOTS, adAllowed, adScriptReady, finishedAdDue, loadAdScript, markFinishedAd, openAdSettings, type AdPage } from '../lib/ads'
import { cx, useStudio } from './ui'

type Status = 'wait' | 'filled' | 'unfilled'

/**
 * One AdSense ad unit. Nothing shows (no label, no space) until Google has filled it;
 * an empty or blocked one stays invisible, so it never leaves a hole in the page.
 */
function AdUnit({ slot, style, responsive, onStatus }: { slot: string; style: CSSProperties; responsive?: boolean; onStatus?: (s: Status) => void }) {
  const ref = useRef<HTMLModElement>(null)
  const [status, setStatus] = useState<Status>('wait')
  const report = useRef(onStatus)
  useEffect(() => {
    report.current = onStatus
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    loadAdScript()
    try {
      ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch {
      /* already filled (React's dev double-run) or blocked */
    }
    const read = () => {
      const s = el.getAttribute('data-ad-status')
      if (!s) return
      const next: Status = s === 'filled' ? 'filled' : 'unfilled'
      setStatus(next)
      report.current?.(next)
    }
    read()
    const obs = new MutationObserver(read)
    obs.observe(el, { attributes: true, attributeFilter: ['data-ad-status'] })
    return () => obs.disconnect()
  }, [slot])

  return (
    <div className={cx('ad-unit', status !== 'filled' && 'ad-waiting')} data-status={status}>
      <div className="ad-label">Advertisement</div>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ display: 'block', ...style }}
        data-ad-client={AD_CLIENT}
        data-ad-slot={slot}
        {...(responsive ? { 'data-ad-format': 'auto', 'data-full-width-responsive': 'true' } : {})}
      />
    </div>
  )
}

/** Is the window at least this big? (Follows resizing.) */
function useFits(minW: number, minH: number) {
  const q = `(min-width: ${minW}px) and (min-height: ${minH}px) and (pointer: fine)`
  const [fits, setFits] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q)
    const on = () => setFits(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [q])
  return fits
}

const RAIL_W = 160
const RAIL_H = 600
const GAP = 40
const TOP = 96

/**
 * Ads beside the page on big screens (desktop): one tall ad in the empty space left
 * and right of the page's column, below the header. Only rendered when there's room
 * for them, so they never cover or squeeze anything.
 */
export function SideAds({ page, column }: { page: AdPage; /** the width of the page's content column, px */ column: number }) {
  const s = useStudio()
  const fits = useFits(column + 2 * (GAP + RAIL_W) + 32, TOP + RAIL_H + 40)
  if (!fits || !adAllowed(s.settings.ads, 'side', page)) return null
  const offset = `calc(50% - ${column / 2 + GAP + RAIL_W}px)`
  return (
    <>
      {[{ left: offset }, { right: offset }].map((pos, i) => (
        <aside key={i} aria-label="advertisement" className="ad-rail fixed z-[1]" style={{ top: TOP, width: RAIL_W, ...pos }}>
          <AdUnit slot={AD_SLOTS.side} style={{ width: RAIL_W, height: RAIL_H }} />
        </aside>
      ))}
    </>
  )
}

/** A banner at the end of a page's content, above the footer (any screen size). */
export function InPageAd({ page }: { page: AdPage }) {
  const s = useStudio()
  if (!adAllowed(s.settings.ads, 'inPage', page)) return null
  return (
    <aside aria-label="advertisement" className="not-prose mt-10">
      <AdUnit slot={AD_SLOTS.inPage} style={{ width: '100%' }} responsive />
      <AdNote />
    </aside>
  )
}

/** "change ads" — a quiet link to the ad settings. */
function AdNote({ className }: { className?: string }) {
  return (
    <button type="button" onClick={openAdSettings} className={cx('ad-note block mx-auto mt-1 text-[10px] text-sub/70 hover:text-text transition-colors', className)}>
      ads keep Lemody free · change ads
    </button>
  )
}

/**
 * After a song plays to its end: one full screen with an ad, between the song and its
 * results. "Continue" is there from the first moment. Not shown more than once every
 * few minutes, not when the ad can't load (blocked, nothing to show), and never while
 * a test is running.
 */
export function SongFinishedAd() {
  const s = useStudio()
  const [open, setOpen] = useState(false)
  const seen = useRef(s.songEnds)

  useEffect(() => {
    if (s.songEnds === seen.current) return
    seen.current = s.songEnds
    if (!adAllowed(s.settings.ads, 'finished') || !adScriptReady() || !finishedAdDue()) return
    markFinishedAd()
    setOpen(true)
  }, [s.songEnds, s.settings.ads])

  // a new test or another song: out of the way
  useEffect(() => {
    if (s.session || s.playing) setOpen(false)
  }, [s.session, s.playing])

  // nothing came within a few seconds: don't keep an empty screen up
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      if (!document.querySelector('.ad-finished .ad-unit[data-status="filled"]')) setOpen(false)
    }, 5000)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))
    const toSettings = () => setOpen(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('lemody:ad-settings', toSettings)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('lemody:ad-settings', toSettings)
    }
  }, [open])

  if (!open) return null
  const close = () => setOpen(false)
  return (
    <div role="dialog" aria-label="song finished" className="ad-finished overlay-in fixed inset-0 z-[65] bg-bg flex flex-col items-center justify-center gap-5 px-4 py-[max(1rem,env(safe-area-inset-top))]">
      <button type="button" onClick={close} aria-label="close" className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 w-9 h-9 rounded-full surface text-sub hover:text-text flex items-center justify-center">
        <X size={16} />
      </button>
      <div className="text-center">
        <div className="text-[11px] uppercase tracking-[0.14em] text-sub">song finished</div>
        {s.track && <div className="mt-1 text-text text-lg font-semibold tracking-tight max-w-[22rem] truncate">{s.track.title}</div>}
      </div>
      <div className="w-full max-w-[336px] min-h-[280px] flex items-center justify-center">
        <div className="w-full">
          <AdUnit slot={AD_SLOTS.finished} style={{ width: '100%', minHeight: 250 }} responsive onStatus={(st) => st === 'unfilled' && close()} />
        </div>
      </div>
      <button type="button" onClick={close} className="rounded-full bg-main text-bg text-sm font-medium px-6 py-2.5 active:scale-95 transition-transform">
        {s.lastResult ? 'see your results' : 'continue'}
      </button>
      <AdNote className="mt-0" />
    </div>
  )
}
