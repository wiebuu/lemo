import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { itemAt, lyricRows, rowAt, sungPoint, wavePath } from '../lib/lyricTiming'
import { studio } from '../state/studio'
import { tidyTitle } from '../lib/titles'
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
  // the lyrics are over: they fade away completely, then the song's name and singer
  // slowly appear in their place (and stay to the end)
  const lastEnd = useMemo(() => {
    const it = rows[rows.length - 1]?.items
    return it?.length ? it[it.length - 1].end : null
  }, [rows])
  const outroAt = (t: number) => lastEnd !== null && t > lastEnd + 0.8
  const [outro, setOutro] = useState(() => outroAt(studio.heardTime()))
  const outroRef = useRef(outro)
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
  const shift = useRef<number | null>(null)
  const lastPaint = useRef(0)
  const gliding = useRef(false)
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
          if (k !== i) {
            el.style.removeProperty('--p')
            // only the pause being waited out waves; one already waited out stays filled
            if (focus && items[k]?.kind === 'gap') drawWave(el, null, k < i ? Infinity : 0)
          }
        })
        shown.current = i
      }
      if (i >= 0) {
        const it = items[i]
        const el = els.current[i]
        if (!el) return
        el.style.setProperty('--p', Math.max(0, Math.min(1, (t - it.start) / Math.max(0.01, it.end - it.start))).toFixed(3))
      }
      // The point being sung always sits in the centre. It moves steadily from one item's
      // start to the next one's (word, space and pause alike), so it never jumps between them.
      const edge = (el: HTMLSpanElement | null, end: boolean) => (el ? el.offsetLeft + (rtl !== end ? el.offsetWidth : 0) : 0)
      const starts = items.map((_, k) => edge(els.current[k], false))
      const x = sungPoint(items, starts, edge(els.current[items.length - 1], true), r < 0 ? -1 : t)
      // full-screen lyrics: the pause line waves gently, swelling a little on each beat, and
      // fills like a pen drawing it — its round tip right at the centre, where the singing is
      if (focus && i >= 0 && items[i].kind === 'gap') {
        const el = els.current[i]!
        const tr = studio.snap.track
        drawWave(el, reducedMotion() ? null : { t, tempo: tr?.tempo, firstBeat: tr?.firstBeat }, rtl ? el.offsetLeft + el.offsetWidth - x : x - el.offsetLeft)
      }
      const target = wrap.current.clientWidth / 2 - x
      // Eased towards the target, so a seek or a slow frame glides instead of jumping;
      // a new line starts in place (it slides in on its own).
      const now = performance.now()
      const prev = shift.current
      const dt = Math.min(0.1, (now - lastPaint.current) / 1000)
      lastPaint.current = now
      const next = prev === null ? target : prev + (target - prev) * (1 - Math.exp(-dt / EASE))
      shift.current = Math.abs(target - next) < 0.3 ? target : next
      gliding.current = shift.current !== target
      track.current.style.transform = `translate3d(${shift.current.toFixed(1)}px,0,0)`
    },
    [rows, items, rtl, focus],
  )

  // A new middle line starts in place (no glide from the last line's position).
  useLayoutEffect(() => void (shift.current = null), [cur, rows])
  // After every render (before the browser paints), re-apply the current colours.
  useLayoutEffect(() => paint(true))

  useEffect(() => {
    let raf = 0
    let lastT = NaN
    let still = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const t = studio.heardTime()
      if (t === lastT && !gliding.current && ++still % 30) return // paused and at rest: skip the layout reads (re-check ~twice a second)
      lastT = t
      const o = outroAt(t)
      if (o !== outroRef.current) {
        outroRef.current = o
        setOutro(o)
        return
      }
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
  }, [rows, paint, lastEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  const prev = cur > 0 ? rows[cur - 1] : null
  // Before the first line starts, it already waits in the middle row (not yet sung).
  const next = rows[Math.max(0, cur) + 1] ?? null
  const estimated = s.lyricsShown.some((l) => l.wordsSource === 'estimated')
  // the song's plain name: no "(From …)", "(feat. …)", "Official Video" …
  const name = tidyTitle((s.track?.title ?? '').replace(/\s*[([](?:from|feat\.?|ft\.?)\s[^)\]]*[)\]]/gi, ''), s.track?.artist ?? '')

  return (
    <div className="relative">
      {/* one leaves, then the other arrives (the same fade as before the first line) */}
      <div className="relative">
      <div aria-hidden={outro} data-shown={!outro} className="stage-swap">
      <div key={cur} className="lyric-rows flex flex-col items-center" style={{ gap: `${z.gap}rem` }}>
        {!phone && <SideLine text={prev?.text} z={z} lines={focus ? 2 : 1} align="end" />}
        <div ref={wrap} className="lyric-ticker w-full overflow-hidden transition-[height] duration-300" style={{ height: `${z.midRow}rem` }}>
          <div ref={track} dir={rtl ? 'rtl' : 'ltr'} className="flex items-center h-full w-max whitespace-pre will-change-transform font-medium tracking-tight transition-[font-size] duration-300"
            style={{ fontSize: `${z.mid}rem` }}>
            {items.map((it, k) =>
              it.kind === 'gap' ? (
                // a pause: one line, as long as the pause, that fills like a sung word — when
                // it's full, sing. Full-screen lyrics: a softly waving line.
                <span key={k} ref={(el) => void (els.current[k] = el)} className={cx('lyric-gap', focus && 'lyric-wave')} aria-label="pause"
                  style={{ width: gapWidth(it.end - it.start, z.scale) }}>
                  {focus ? (
                    <svg aria-hidden><path className="wave-base" /><path className="wave-on" /></svg>
                  ) : (
                    <span />
                  )}
                </span>
              ) : (
                <span key={k} ref={(el) => void (els.current[k] = el)} className="lyric-word">{it.text}</span>
              ),
            )}
          </div>
        </div>
        <SideLine text={next?.text} z={z} lines={2} align="start" next />
      </div>
      </div>
      <div aria-hidden={!outro} data-shown={outro} className="stage-swap absolute inset-0 flex flex-col items-center justify-center text-center px-6"
        style={{ transitionDuration: outro ? '1.6s' : undefined }}>
        <div dir="auto" className="text-text font-medium tracking-tight truncate max-w-full" style={{ fontSize: `${z.mid * 0.8}rem`, lineHeight: 1.25 }}>{name.title || s.track?.title}</div>
        {name.artist && <div dir="auto" className="text-sub truncate max-w-full mt-1" style={{ fontSize: `${z.side}rem` }}>{name.artist}</div>}
      </div>
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

/** A pause line's length (px): about 60 px a second, 28–300 px, scaled with the lyrics. */
const gapWidth = (dur: number, scale: number) => Math.max(28, Math.min(300, dur * 60)) * scale

/**
 * Draw a full-screen pause line: waving at time t, or still (null); filled from its start
 * up to `to` px (0: not yet, Infinity: all), ending in a round pen tip.
 */
function drawWave(el: HTMLElement, at: { t: number; tempo?: number; firstBeat?: number } | null, to: number) {
  const w = el.offsetWidth, h = el.offsetHeight
  const upto = Math.max(0, Math.min(w, to))
  const key = at ? '' : `still:${upto}`
  if (key && el.dataset.wave === key) return
  el.dataset.wave = key
  const [base, on] = el.querySelectorAll('path')
  base?.setAttribute('d', wavePath(w, h, at))
  on?.setAttribute('d', upto > 0 ? wavePath(w, h, at, upto) : '')
}
let reduced: MediaQueryList | null = null
const reducedMotion = () => (reduced ??= matchMedia('(prefers-reduced-motion: reduce)')).matches

/** How quickly the line glides to keep the sung point centred (s; smaller = tighter). */
const EASE = 0.07

export interface LyricSizes { scale: number; mid: number; side: number; midRow: number; sideLine: number; gap: number }

/**
 * Lyric sizes in rem for a layout and the singer's zoom. Each row's height comes from
 * its own text size, so rows never run into each other at any zoom.
 */
export function lyricSizes(mode: 'normal' | 'big' | 'focus', phone: boolean, scale: number): LyricSizes {
  const [mid, side] =
    // phones: the line being sung is clearly the biggest, but not oversized next to the others
    mode === 'focus' ? (phone ? [1.85, 1.1] : [3.6, 1.45]) : mode === 'big' ? (phone ? [1.4, 0.95] : [1.875, 1]) : phone ? [1.25, 0.875] : [1.7, 0.875]
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
 * When lyrics (or some lines) can't be shown in the chosen script — English letters, Hindi or
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
