import { createPortal } from 'react-dom'
import { Loader2, Pause, Play, RotateCcw, X } from 'lucide-react'
import { NO_FX, type VoiceFx } from '../lib/voiceFx'
import { studio } from '../state/studio'
import { cx, useStudio } from './ui'

const ROWS: { key: keyof VoiceFx; label: string; min: number; max: number; step: number; show: (v: number) => string; heavy?: boolean }[] = [
  { key: 'tune', label: 'Tune to original', min: 0, max: 1, step: 0.05, show: (v) => (v ? `${Math.round(v * 100)}%` : 'off'), heavy: true },
  { key: 'pitch', label: 'Pitch', min: -12, max: 12, step: 1, show: (v) => (v ? `${v > 0 ? '+' : ''}${v} st` : '0'), heavy: true },
  { key: 'echo', label: 'Echo', min: 0, max: 1, step: 0.05, show: (v) => (v ? `${Math.round(v * 100)}%` : 'off') },
  { key: 'reverb', label: 'Reverb', min: 0, max: 1, step: 0.05, show: (v) => (v ? `${Math.round(v * 100)}%` : 'off') },
  { key: 'tone', label: 'Tone', min: -1, max: 1, step: 0.1, show: (v) => (Math.abs(v) < 0.05 ? 'natural' : v < 0 ? 'warm' : 'bright') },
  { key: 'volume', label: 'Your volume', min: 0, max: 1.5, step: 0.05, show: (v) => `${Math.round(v * 100)}%` },
]

/**
 * Results screen: shape how your take sounds — pull it onto the original melody,
 * shift its pitch, add echo / reverb, warm or brighten it — and hear the change
 * straight away while it plays.
 */
export function VoiceFxPanel({ onClose }: { onClose: () => void }) {
  const s = useStudio()
  const fx = s.voiceFx
  const changed = (Object.keys(NO_FX) as (keyof VoiceFx)[]).some((k) => fx[k] !== NO_FX[k])
  return createPortal(
    <aside
      aria-label="voice effects"
      className={cx(
        'sheet-in modal-card fixed z-40 flex flex-col shadow-2xl',
        'inset-x-0 bottom-0 rounded-t-2xl max-h-[62dvh] pb-[env(safe-area-inset-bottom)]',
        'sm:inset-x-auto sm:right-5 sm:top-20 sm:bottom-auto sm:w-72 sm:rounded-2xl sm:max-h-[calc(100dvh-7rem)] sm:pb-0',
      )}
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0">
        <button type="button" onClick={() => void studio.togglePlay()} aria-label={s.playing ? 'pause' : 'play'}
          className="w-8 h-8 rounded-full bg-main text-bg flex items-center justify-center shrink-0">
          {s.playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text leading-tight">Your voice</div>
          {s.listenSource !== 'me' && <div className="text-[11px] text-sub leading-tight">switch to “you” to hear it</div>}
        </div>
        <span className="flex-1" />
        <button type="button" onClick={() => studio.resetVoiceFx()} disabled={!changed} aria-label="reset effects"
          className="p-1.5 text-sub hover:text-text disabled:opacity-30"><RotateCcw size={14} /></button>
        <button type="button" onClick={onClose} aria-label="close effects" className="p-1.5 text-sub hover:text-text"><X size={15} /></button>
      </div>
      <div className="overflow-y-auto overscroll-contain px-4 pb-4 flex flex-col gap-3.5">
        {ROWS.map((r) => (
          <label key={r.key} className="block">
            <span className="flex items-baseline justify-between text-[12px]">
              <span className="text-text">{r.label}</span>
              <span className="flex items-center gap-1 text-sub tabular-nums">
                {r.heavy && s.voiceFxBusy && fx[r.key] !== NO_FX[r.key] && <Loader2 size={11} className="animate-spin" />}
                {r.show(fx[r.key])}
              </span>
            </span>
            <input type="range" min={r.min} max={r.max} step={r.step} value={fx[r.key]}
              onChange={(e) => studio.setVoiceFx({ [r.key]: Number(e.target.value) })}
              onDoubleClick={() => studio.setVoiceFx({ [r.key]: NO_FX[r.key] })}
              className="fx-range w-full mt-1"
              style={{ '--p': `${((fx[r.key] - r.min) / (r.max - r.min)) * 100}%` } as React.CSSProperties} />
          </label>
        ))}
      </div>
    </aside>,
    document.body,
  )
}
