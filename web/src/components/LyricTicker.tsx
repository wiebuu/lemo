import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { itemAt, lyricRows, rowAt } from '../lib/lyricTiming'
import { studio } from '../state/studio'
import { Languages } from 'lucide-react'
import { cx, Eq, Tip, usePhone, useStudio } from './ui'

/**
 * Three-row karaoke: previous line (faint) · the line being sung · next line (faint).
 * The middle row keeps the moving style — the word being sung sits in the centre and
 * fills with colour, pauses are straight lines as long as the pause. Rows slide up
 * when the line changes. Driven by its own animation frame; React only re-renders
 * on a line change.
 */
export function LyricTicker({ big, focus, onFix }: { big?: boolean; /** lyrics only: the lines large in the middle of the screen */ focus?: boolean; /** shows "wrong lyrics?" */ onFix?: () => void }) {
  const s = useStudio()
  const onPhone = usePhone()
  const phone = onPhone && !focus // phones: the line being sung and the next one (no room for the last one)
  const z = lyricSizes(focus ? 'focus' : big ? 'big' : 'normal', onPhone, s.settings.lyricsScale)
  const rows = useMemo(() => lyricRows(s.lyricsShown), [s.lyricsShown])
  const [cur, setCur] = useState(() => rowAt(rows, studio.heardTime()))
  const curRef = useRef(cur)
  const wrap = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const els = useRef<(HTMLSpanElement | null)[]>([])
  const middle = rows[Math.max(0, cur)]
  const items = middle?.items ?? []
  // Urdu reads right to left: words flow that way and fill from the right
  const rtl = /[\u0600-\u06FF]/.test(middle?.text ?? '')

  // Word colours are set here, not by React — otherwise any unrelated re-render
  // would reset them to "upcoming" for a frame (that was the blinking).
  const shown = useRef(-2)
  const paint = useCallback(
    (force: boolean) => {
      if (!wrap.current || !track.current || !items.length) return
      const t = studio.heardTime()
      const r = rowAt(rows, t)
      const i = r < 0 ? -1 : itemAt(items, t)
      if (force || i !== shown.current) {
        els.current.forEach((el, k) => {
          if (!el) return
          const state = k < i ? 'past' : k === i ? 'now' : 'next'
          if (el.dataset.state !== state) el.dataset.state = state
          if (k !== i) el.style.removeProperty('--p')
        })
        shown.current = i
      }
      let x = els.current[0]?.offsetLeft ?? 0
      if (i >= 0) {
        const it = items[i]
        const el = els.current[i]
        if (!el) return
        const frac = Math.max(0, Math.min(1, (t - it.start) / Math.max(0.01, it.end - it.start)))
        el.style.setProperty('--p', frac.toFixed(3))
        x = el.offsetLeft + (rtl ? 1 - frac : frac) * el.offsetWidth
      }
      // Short lines stay centred as a whole; long lines glide to keep the sung word centred.
      const W = wrap.current.clientWidth
      const full = track.current.scrollWidth
      const shift = full <= W - 2 * EDGE_FADE - 16 ? (W - full) / 2 : W / 2 - x
      track.current.style.transform = `translate3d(${shift.toFixed(1)}px,0,0)`
    },
    [rows, items, rtl],
  )

  // After every render (before the browser paints), re-apply the current colours.
  useLayoutEffect(() => paint(true))

  useEffect(() => {
    let raf = 0
    let lastT = NaN
    let still = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const t = studio.heardTime()
      if (t === lastT && ++still % 30) return // paused: skip the layout reads (re-check ~twice a second)
      lastT = t
      const r = rowAt(rows, t)
      if (r !== curRef.current) {
        curRef.current = r
        setCur(r) // new middle line → re-render (colours re-applied in the layout effect)
        return
      }
      paint(false)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [rows, paint])

  const prev = cur > 0 ? rows[cur - 1] : null
  // Before the first line starts, it already waits in the middle row (not yet sung).
  const next = rows[Math.max(0, cur) + 1] ?? null
  const estimated = s.lyricsShown.some((l) => l.wordsSource === 'estimated')

  return (
    <div className="relative">
      <div key={cur} className="lyric-rows flex flex-col items-center" style={{ gap: `${z.gap}rem` }}>
        {!phone && <SideLine text={prev?.text} z={z} lines={focus ? 2 : 1} align="end" />}
        <div ref={wrap} className="lyric-ticker w-full overflow-hidden transition-[height] duration-300" style={{ height: `${z.midRow}rem` }}>
          <div ref={track} dir={rtl ? 'rtl' : 'ltr'} className="flex items-center h-full w-max whitespace-pre will-change-transform font-medium tracking-tight transition-[font-size] duration-300"
            style={{ fontSize: `${z.mid}rem` }}>
            {items.map((it, k) =>
              it.kind === 'gap' ? (
                <span key={k} ref={(el) => void (els.current[k] = el)} className="lyric-gap"
                  style={{ width: Math.max(28, Math.min(260, (it.end - it.start) * 56)) * z.scale }}>
                  <span />
                </span>
              ) : (
                <span key={k} ref={(el) => void (els.current[k] = el)} className="lyric-word">{it.text}</span>
              ),
            )}
          </div>
        </div>
        <SideLine text={next?.text} z={z} lines={2} align="start" next />
      </div>
      {/* its own row under the lines: never over the lines or the player below */}
      <div className={cx('flex items-center gap-2 text-[11px] text-sub h-4', focus ? 'justify-center mt-4' : 'justify-end mt-1')}>
        {onFix && <FixLink onFix={onFix} />}
        {s.lyricsStatus && <span className="flex items-center gap-2"><Eq />{s.lyricsStatus}</span>}
        {!s.lyricsStatus && <ScriptNotice />}
        {!s.lyricsStatus && estimated && (
          <Tip wide tip={<>Word timing is estimated from the melody's notes{s.lyricsNote && !s.lyricsNote.startsWith('script:') ? <> — {s.lyricsNote}.</> : '.'} Fix lines in the lyrics editor (pencil icon).</>}>
            <span>≈</span>
          </Tip>
        )}
      </div>
    </div>
  )
}

/** The ticker's edges fade over this many pixels (the sung word always sits clear of it). */
const EDGE_FADE = 24

export interface LyricSizes { scale: number; mid: number; side: number; midRow: number; sideLine: number; gap: number }

/**
 * Lyric sizes in rem for a layout and the singer's zoom. Each row's height comes from
 * its own text size, so rows never run into each other at any zoom.
 */
export function lyricSizes(mode: 'normal' | 'big' | 'focus', phone: boolean, scale: number): LyricSizes {
  const [mid, side] =
    mode === 'focus' ? (phone ? [2.4, 1.1] : [3.6, 1.45]) : mode === 'big' ? (phone ? [1.7, 0.95] : [1.875, 1]) : phone ? [1.5, 0.875] : [1.7, 0.875]
  return {
    scale,
    mid: mid * scale,
    side: side * scale,
    midRow: mid * scale * 1.55,
    sideLine: side * scale * 1.5,
    gap: (mode === 'focus' ? 0.75 : 0.25) * scale,
  }
}

/**
 * The line before or after the one being sung. Up to `lines` lines (wrapping, never cut
 * off mid-word); its room is always kept, so the rows don't jump when it's empty or short.
 */
export function SideLine({ text, z, lines, align, next }: { text?: string; z: LyricSizes; lines: 1 | 2; align: 'start' | 'end'; next?: boolean }) {
  return (
    <div className={cx('w-full flex flex-col px-6', align === 'end' ? 'justify-end' : 'justify-start')}
      style={{ height: `${z.sideLine * lines}rem` }}>
      <div dir="auto" className={cx('lyric-side text-center text-balance transition-[font-size] duration-300', next && 'lyric-next', lines === 2 ? 'line-clamp-2' : 'truncate')}
        style={{ fontSize: `${z.side}rem`, lineHeight: 1.5 }}>
        {text ?? ''}
      </div>
    </div>
  )
}

/**
 * When lyrics (or some lines) can't be shown in the chosen script — Hinglish, Hindi or
 * Urdu — a small, plain note says so, so lines in another script never look like a glitch.
 */
export function ScriptNotice() {
  const s = useStudio()
  if (!s.lyricsNote?.startsWith('script:')) return null
  const [short, why] = s.lyricsNote.slice(7).split('|')
  return (
    <Tip wide tip={why || short}>
      <span className="inline-flex items-center gap-1.5 text-[11px] text-sub">
        <Languages size={12} className="shrink-0" />
        {short}
      </span>
    </Tip>
  )
}

/** "wrong lyrics?": always there in practice — whatever the lyrics' source, or none at all. */
export function FixLink({ onFix, label = 'wrong lyrics?' }: { onFix: () => void; label?: string }) {
  return (
    <button type="button" onClick={onFix} className="text-[11px] text-sub hover:text-text transition-colors">{label}</button>
  )
}
