import { useEffect, type CSSProperties, type RefObject } from 'react'
import { ALargeSmall, Captions, ChartSpline } from 'lucide-react'
import { LYRICS_SCALE } from '../state/persist'
import { studio } from '../state/studio'
import { cx, Divider, Menu, MenuLabel, Tip, useStudio } from './ui'

const clampScale = (v: number) => Math.round(Math.min(LYRICS_SCALE.max, Math.max(LYRICS_SCALE.min, v)) * 100) / 100
const pct = (v: number) => `${Math.round(v * 100)}%`

/**
 * How the stage looks: lyrics size, and graph ⇄ lyrics only. Its own pill beside the
 * settings bar, before singing (not while singing, nor on the results).
 */
export function ViewControls() {
  const s = useStudio()
  const lyricsOnly = s.settings.lyricsOnly
  // lyrics only: captions (the lyrics on their own); back to the graph: the melody line
  const ToggleIcon = lyricsOnly ? ChartSpline : Captions
  const toggle = (
    <Tip tip={lyricsOnly ? 'Show the graph again' : 'Lyrics only — hide the graph (it keeps listening)'}>
      <button type="button" aria-pressed={lyricsOnly} aria-label={lyricsOnly ? 'show the graph' : 'lyrics only'}
        onClick={() => studio.updateSettings({ lyricsOnly: !lyricsOnly })}
        className="flex items-center gap-1.5 p-1.5 rounded-md text-sub hover:text-text transition-colors">
        <ToggleIcon size={15} />
        <span className="hidden sm:inline text-xs">{lyricsOnly ? 'graph' : 'lyrics only'}</span>
      </button>
    </Tip>
  )
  const size = (
    <Menu tip={`Lyrics size · ${pct(s.settings.lyricsScale)} — or pinch the lyrics (⌘ / ctrl + scroll on a computer)`}
      buttonClassName="px-1.5"
      button={<span className="flex items-center gap-1.5"><ALargeSmall size={16} /></span>}>
      <LyricsSize />
    </Menu>
  )
  return (
    <div className="surface rounded-full px-2 sm:px-3 py-0.5 text-xs flex items-center gap-0.5 sm:gap-2 shrink-0">
      {size}
      <Divider />
      {toggle}
    </div>
  )
}

function LyricsSize() {
  const s = useStudio()
  const v = s.settings.lyricsScale
  const fill = ((v - LYRICS_SCALE.min) / (LYRICS_SCALE.max - LYRICS_SCALE.min)) * 100
  return (
    <div>
      <MenuLabel>lyrics size</MenuLabel>
      <div className="flex items-baseline justify-center pt-1 pb-2">
        <span className="text-2xl font-medium tabular-nums text-text">{pct(v)}</span>
      </div>
      <div className="px-1 flex items-center gap-2">
        <ALargeSmall size={12} className="text-sub shrink-0" />
        <input type="range" min={LYRICS_SCALE.min} max={LYRICS_SCALE.max} step={LYRICS_SCALE.step} value={v} aria-label="lyrics size"
          className="speed-range w-full" style={{ '--fill': `${fill}%` } as CSSProperties}
          onChange={(e) => studio.updateSettings({ lyricsScale: clampScale(Number(e.target.value)) })} />
        <ALargeSmall size={17} className="text-sub shrink-0" />
      </div>
      <div className="flex px-1 mt-2">
        <button type="button" disabled={v === 1} onClick={() => studio.updateSettings({ lyricsScale: 1 })}
          className={cx('flex-1 h-7 rounded-md text-[11px] transition-colors', v === 1 ? 'text-sub/50' : 'text-sub hover:text-text hover:bg-bg/40')}>
          normal size
        </button>
      </div>
    </div>
  )
}

/**
 * Pinch (two fingers) or ⌘ / ctrl + scroll (a trackpad pinch) over `ref` to make the
 * lyrics bigger or smaller, within LYRICS_SCALE.
 */
export function useLyricsPinch(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const set = (v: number) => {
      const next = clampScale(v)
      if (next !== studio.snap.settings.lyricsScale) studio.updateSettings({ lyricsScale: next })
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      e.stopPropagation() // not the graph's time zoom underneath
      set(studio.snap.settings.lyricsScale * Math.exp(-e.deltaY * 0.01))
    }
    return attachPinch(el, () => studio.snap.settings.lyricsScale, set, onWheel)
  }, [ref])
}

/** Two-finger pinch on an element: `apply(start × ratio)` as the fingers move apart / together. */
export function attachPinch(el: HTMLElement, start: () => number, apply: (v: number) => void, onWheel?: (e: WheelEvent) => void) {
  const touches = new Map<number, { x: number; y: number }>()
  let base: { dist: number; value: number } | null = null
  const dist = () => {
    const [a, b] = [...touches.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.size === 2) base = { dist: Math.max(20, dist()), value: start() }
  }
  const move = (e: PointerEvent) => {
    if (!touches.has(e.pointerId)) return
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (base && touches.size === 2) {
      e.stopPropagation()
      apply(base.value * (dist() / base.dist))
    }
  }
  const up = (e: PointerEvent) => {
    touches.delete(e.pointerId)
    if (touches.size < 2) base = null
  }
  el.addEventListener('pointerdown', down)
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
  if (onWheel) el.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    if (onWheel) el.removeEventListener('wheel', onWheel)
  }
}
