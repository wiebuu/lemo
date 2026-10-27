import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { itemAt, lyricRows, rowAt } from '../lib/lyricTiming'
import { studio } from '../state/studio'
import { cx, Eq, Tip, useStudio } from './ui'

/**
 * Three-row karaoke: previous line (faint) · the line being sung · next line (faint).
 * The middle row keeps the moving style — the word being sung sits in the centre and
 * fills with colour, pauses are straight lines as long as the pause. Rows slide up
 * when the line changes. Driven by its own animation frame; React only re-renders
 * on a line change.
 */
export function LyricTicker({ big, onFix }: { big?: boolean; /** shows "wrong lyrics?" */ onFix?: () => void }) {
  const s = useStudio()
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
      const shift = full <= W * 0.9 ? (W - full) / 2 : W / 2 - x
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
      <div key={cur} className="lyric-rows flex flex-col items-center gap-1">
        <div dir="auto" className={cx('lyric-side h-6 leading-6 max-w-full truncate px-6 text-center transition-all duration-500', big ? 'text-base' : 'text-sm')}>
          {prev?.text ?? ''}
        </div>
        <div ref={wrap} className={cx('lyric-ticker w-full overflow-hidden transition-all duration-500', big ? 'h-14' : 'h-12')}>
          <div ref={track} dir={rtl ? 'rtl' : 'ltr'} className={cx('flex items-center h-full w-max whitespace-pre will-change-transform transition-[font-size] duration-500', big ? 'text-3xl font-medium tracking-tight' : 'text-[1.7rem] font-medium tracking-tight')}>
            {items.map((it, k) =>
              it.kind === 'gap' ? (
                <span key={k} ref={(el) => void (els.current[k] = el)} className="lyric-gap"
                  style={{ width: Math.max(28, Math.min(260, (it.end - it.start) * 56)) }}>
                  <span />
                </span>
              ) : (
                <span key={k} ref={(el) => void (els.current[k] = el)} className="lyric-word">{it.text}</span>
              ),
            )}
          </div>
        </div>
        <div dir="auto" className={cx('lyric-side lyric-next h-6 leading-6 max-w-full truncate px-6 text-center transition-all duration-500', big ? 'text-base' : 'text-sm')}>
          {next?.text ?? ''}
        </div>
      </div>
      <div className="absolute right-0 -bottom-5 flex items-center gap-2 text-[11px] text-sub">
        {onFix && <FixLink onFix={onFix} />}
        {s.lyricsStatus && <span className="flex items-center gap-2"><Eq />{s.lyricsStatus}</span>}
        {!s.lyricsStatus && s.lyricsNote?.startsWith('script:') && (
          <Tip wide tip={s.lyricsNote.slice(8)}>
            <span>some lines kept as found</span>
          </Tip>
        )}
        {!s.lyricsStatus && estimated && (
          <Tip wide tip={<>Word timing is estimated from the melody's notes{s.lyricsNote ? <> — {s.lyricsNote}.</> : '.'} Fix lines in the lyrics editor (pencil icon).</>}>
            <span>≈</span>
          </Tip>
        )}
      </div>
    </div>
  )
}

/** "wrong lyrics?": always there in practice — whatever the lyrics' source, or none at all. */
export function FixLink({ onFix, label = 'wrong lyrics?' }: { onFix: () => void; label?: string }) {
  return (
    <button type="button" onClick={onFix} className="text-[11px] text-sub hover:text-text transition-colors">{label}</button>
  )
}
