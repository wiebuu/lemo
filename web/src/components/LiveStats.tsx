import { useEffect, useRef } from 'react'
import { ArrowDown, ArrowUp, Check, TriangleAlert, Volume1, Volume2 } from 'lucide-react'
import { midiToNoteName } from '../lib/music'
import { studio } from '../state/studio'
import { ListenControls } from './Results'
import { cx, Tip, usePhone, useStudio } from './ui'

/**
 * Live readout above the graph: one big symbol telling you what to do right now.
 * Updated imperatively (~20 Hz) by toggling visibility — no React re-render per frame.
 */
export function LiveStats({ big, center }: { big?: boolean; /** phones: the song's name, between the note and the controls */ center?: React.ReactNode }) {
  const s = useStudio()
  const phone = usePhone()
  const note = useRef<HTMLSpanElement>(null)
  const icons = useRef<Record<string, HTMLSpanElement | null>>({})
  const meter = useRef<HTMLSpanElement>(null)

  useEffect(
    () =>
      studio.onLive((l) => {
        if (!note.current) return
        const g = l.guidance
        // Only show a note while someone is singing — no placeholder filler.
        note.current.textContent = l.midi !== null ? midiToNoteName(l.midi) : ''
        note.current.style.color = 'var(--main)'
        const show = (k: string, on: boolean) => {
          const el = icons.current[k]
          if (el) el.style.display = on ? 'inline-flex' : 'none'
        }
        show('on', g.pitch === 'on')
        show('up', g.pitch === 'higher')
        show('down', g.pitch === 'lower')
        show('more', g.dynamics === 'more')
        show('softer', g.dynamics === 'softer')
        show('clash', l.clash)
        if (meter.current) meter.current.style.width = `${Math.min(100, Math.sqrt(l.level) * 260)}%`
      }),
    [],
  )
  const reg = (k: string) => (el: HTMLSpanElement | null) => void (icons.current[k] = el)
  const hidden = { display: 'none' }

  return (
    <div className={cx('relative flex items-center justify-between px-1 transition-all duration-500', center ? 'gap-2' : 'gap-4', big ? 'min-h-[4.5rem]' : 'min-h-[2.75rem]')}>
      <div className="flex items-center gap-3 shrink-0">
        <Tip tip="The note you're singing right now.">
          <span ref={note} className={cx('font-medium tabular-nums w-[3.5ch] transition-all duration-500', big ? 'text-6xl' : 'text-4xl')} />
        </Tip>
        <span className={cx('flex items-center gap-2 transition-transform duration-500 origin-left', big && 'scale-[1.35]')}>
          <span ref={reg('on')} style={hidden}><Tip tip="On the line"><Check className="text-main" size={26} /></Tip></span>
          <span ref={reg('up')} style={hidden}><Tip tip="Go a little higher"><ArrowUp className="text-flat" size={26} /></Tip></span>
          <span ref={reg('down')} style={hidden}><Tip tip="Go a little lower"><ArrowDown className="text-sharp" size={26} /></Tip></span>
          <span ref={reg('more')} style={hidden}><Tip tip="Sing with more energy here"><Volume2 className="text-text" size={22} /></Tip></span>
          <span ref={reg('softer')} style={hidden}><Tip tip="Sing softer here"><Volume1 className="text-text" size={22} /></Tip></span>
          <span ref={reg('clash')} style={hidden}><Tip tip="This note clashes with the music — try changing the key"><TriangleAlert className="text-error" size={22} /></Tip></span>
        </span>
      </div>
      {/* centred on the screen; beside the results' controls it takes the space left of them */}
      {center && (s.lastResult && !s.session
        ? <div className="flex-1 min-w-0 text-left">{center}</div>
        : <div className="absolute left-1/2 -translate-x-1/2 max-w-[56%] text-center pointer-events-none">{center}</div>)}
      {s.lastResult && !s.session ? (
        <ListenControls />
      ) : (
      <div className="flex items-center gap-4 text-xs text-sub shrink-0">
        {s.phrases.length > 0 && !phone && ( // phones: no room to spare above the graph
          <Tip tip="Line of the song">
            <span className="tabular-nums">{Math.max(1, s.phrase + 1)}/{s.phrases.length}</span>
          </Tip>
        )}
        {s.mic === 'on' && (
          <Tip tip="Microphone level — it should move when you sing.">
            <span className="fade-in w-14 h-1 rounded bg-sub-alt overflow-hidden flex">
              <span ref={meter} className="h-full bg-main transition-[width] duration-75" style={{ width: 0 }} />
            </span>
          </Tip>
        )}
      </div>
      )}
    </div>
  )
}
