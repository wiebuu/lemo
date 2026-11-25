import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AD_CLIENT, AD_SLOTS, adAllowed, adScriptReady, loadAdScript, openAdSettings, type AdPage } from '../lib/ads'
import { cx, usePhone, useStudio } from './ui'

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
 * After a song plays to its end: one banner in the page, between the graph and the
 * results (the graph makes room for it; nothing is covered and nothing floats). It goes
 * as soon as the song plays again, a test starts or another song opens. Not shown when
 * the ad can't load (blocked, nothing to show): then the graph keeps its full height.
 */
export function SongEndAd() {
  const s = useStudio()
  const phone = usePhone()
  const [shown, setShown] = useState(false)
  const seen = useRef(s.songEnds)
  const track = s.track?.id

  useEffect(() => {
    if (s.songEnds === seen.current) return
    seen.current = s.songEnds
    if (adAllowed(s.settings.ads, 'finished') && adScriptReady()) setShown(true)
  }, [s.songEnds, s.settings.ads])

  // playing again, a test, another song or ads turned off: out of the way
  useEffect(() => {
    if (s.session || s.playing || !adAllowed(s.settings.ads, 'finished')) setShown(false)
  }, [s.session, s.playing, s.settings.ads])
  useEffect(() => setShown(false), [track])

  if (!shown) return null
  return (
    <aside aria-label="advertisement" className="ad-song-end fade-in shrink-0 w-full flex flex-col items-center pt-2 sm:pt-3">
      <div className="w-full max-w-[728px]">
        <AdUnit slot={AD_SLOTS.finished} style={{ width: '100%', height: phone ? 50 : 90 }} onStatus={(st) => st === 'unfilled' && setShown(false)} />
      </div>
    </aside>
  )
}
