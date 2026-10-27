import { useEffect, useRef } from 'react'
import { GraphRenderer } from '../render/graph'
import { studio } from '../state/studio'
import { BusyCard, useStudio } from './ui'
import { VoiceCoach } from './VoiceCoach'

export function Graph({ onImport }: { onImport: () => void }) {
  const s = useStudio()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<GraphRenderer | null>(null)

  useEffect(() => {
    const r = new GraphRenderer(canvas.current!)
    renderer.current = r
    const ro = new ResizeObserver(([e]) => r.resize(e.contentRect.width, e.contentRect.height))
    ro.observe(wrap.current!)
    studio.attachRenderer(r)
    return () => {
      ro.disconnect()
      studio.attachRenderer(null)
    }
  }, [])

  useEffect(() => {
    const el = wrap.current!
    // Swipe left/right (or shift+wheel) scrolls through the song; pinch / ⌘+wheel
    // zooms time; ⌥+wheel zooms pitch. Plain vertical scrolling is left to the page.
    const onWheel = (e: WheelEvent) => {
      const st = studio.snap.settings
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const pps = Math.max(40, Math.min(500, st.pxPerSec * (e.deltaY > 0 ? 0.92 : 1.08)))
        studio.updateSettings({ pxPerSec: Math.round(pps) })
      } else if (e.altKey) {
        e.preventDefault()
        const span = Math.max(8, Math.min(40, st.semitoneSpan + Math.sign(e.deltaY || e.deltaX) * 2))
        studio.updateSettings({ semitoneSpan: span })
      } else if (horizontal && studio.snap.track) {
        e.preventDefault()
        const px = e.deltaX || e.deltaY
        studio.scrollBy((px * (e.deltaMode === 1 ? 16 : 1)) / st.pxPerSec)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Touch: drag sideways to move through the song; a tap (no drag) jumps there.
  const drag = useRef<{ x: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || !s.track) return
    drag.current = { x: e.clientX, moved: false }
    dragged.current = false
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 8) return
    d.moved = true
    dragged.current = true
    d.x = e.clientX
    studio.scrollBy(-dx / s.settings.pxPerSec)
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const onClick = (e: React.MouseEvent) => {
    const r = renderer.current
    if (dragged.current) {
      dragged.current = false
      return
    }
    if (!r || !s.track) return
    const rect = wrap.current!.getBoundingClientRect()
    studio.seek(r.timeAtX(e.clientX - rect.left, { time: studio.heardTime(), pxPerSec: s.settings.pxPerSec }))
  }

  const noMelody = s.track && s.track.notes.length === 0 && !s.track.contour
  return (
    <div
      ref={wrap}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ touchAction: 'none' }}
      className="relative w-full flex-1 min-h-[160px] cursor-crosshair select-none"
      aria-label="pitch graph: click to jump, scroll to zoom"
    >
      <canvas ref={canvas} className="absolute inset-0 w-full h-full" />
      {s.track && !noMelody && (
        <div className="absolute top-1 left-10 flex items-center gap-4 text-[11px] text-sub pointer-events-none" aria-hidden>
          <span className="flex items-center gap-1.5"><span className="w-4 h-[3px] rounded-full bg-voice" />you</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-[3px] rounded-full bg-text/60" />original</span>
        </div>
      )}
      {noMelody && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-sub text-center px-6 pointer-events-none">
          <div>no reference melody for this audio yet</div>
          <div className="text-xs max-w-md leading-relaxed">
            analyse it with the local analyzer, or import a chart you have (UltraStar .txt, MIDI, .kar).
          </div>
          <button
            type="button"
            className="pointer-events-auto text-xs text-text hover:text-main"
            onClick={(e) => {
              e.stopPropagation()
              onImport()
            }}
          >
            import chart →
          </button>
        </div>
      )}
      {s.session && <VoiceCoach issue={s.voiceIssue} />}
      {s.busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/60">
          <BusyCard label={s.busy} progress={s.busyProgress} detail={s.busyDetail} />
        </div>
      )}
    </div>
  )
}
