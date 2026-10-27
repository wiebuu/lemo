import { useRef } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { FeaturedItem } from '../api/analyzer'
import { formatTime } from '../lib/music'
import { PreviewButton, type Preview } from './SongSearch'
import { cx } from './ui'

/**
 * One featured group as a row of compact cards that scrolls sideways — far less
 * room than a long list. Tap a card to sing it; ▶ plays 10 seconds first.
 */
export function FeaturedShelf({ label, items, plays, opening, preview, onOpen }: {
  label: string
  items: FeaturedItem[]
  plays: Map<string, number>
  opening: string | null
  preview: Preview
  onOpen: (id: string) => void
}) {
  const row = useRef<HTMLDivElement>(null)
  const scroll = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <section className="mb-5">
      <div className="flex items-center gap-2 mb-2 px-0.5">
        <span className="text-[10px] uppercase tracking-[0.16em] text-main font-medium">{label}</span>
        <span className="text-[10px] text-sub tabular-nums">{items.length}</span>
        <span className="flex-1" />
        <span className="hidden [@media(pointer:fine)]:flex gap-0.5">
          <button type="button" aria-label={`scroll ${label} back`} onClick={() => scroll(-1)} className="p-1 rounded-full text-sub hover:text-text hover:bg-sub-alt"><ChevronLeft size={14} /></button>
          <button type="button" aria-label={`scroll ${label} on`} onClick={() => scroll(1)} className="p-1 rounded-full text-sub hover:text-text hover:bg-sub-alt"><ChevronRight size={14} /></button>
        </span>
      </div>
      <div ref={row} className="shelf flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-1 px-1 pb-1">
        {items.map((f) => {
          const busy = !f.ready && f.stage && !['failed', 'cancelled'].includes(f.stage)
          const status = f.ready ? null : busy ? (f.stage === 'queued' || f.stage === 'waiting' ? 'queued' : `${Math.round(f.progress * 100)}%`) : 'not ready'
          const n = f.id ? plays.get(f.id) : undefined
          return (
            <div key={f.title} className={cx('group relative snap-start shrink-0 w-[9.5rem] sm:w-[10.5rem] rounded-lg surface transition-colors', f.ready && 'hover:border-main/40')}>
              <button type="button" disabled={!f.ready || !f.id || !!opening} onClick={() => f.id && onOpen(f.id)}
                aria-label={`sing ${f.title}${f.artist ? ` by ${f.artist}` : ''}`}
                className="block w-full text-left px-3 py-2.5 pr-10 disabled:cursor-default">
                <div className={cx('text-[13px] font-medium leading-tight truncate', f.ready ? 'text-text group-hover:text-main' : 'text-sub')} title={f.title}>{f.title}</div>
                <div className="text-[11px] text-sub truncate leading-tight mt-1">{f.artist}</div>
                <div className="text-[10px] text-sub/70 tabular-nums mt-1 h-3.5 flex items-center gap-1">
                  {opening && opening === f.id ? (
                    <span className="flex items-center gap-1 text-main"><Loader2 size={10} className="animate-spin" />opening</span>
                  ) : status ? (
                    <span className="flex items-center gap-1">{busy && status !== 'queued' && <Loader2 size={10} className="animate-spin" />}{status}</span>
                  ) : (
                    [n ? `${n} play${n > 1 ? 's' : ''}` : null, f.duration ? formatTime(f.duration) : null].filter(Boolean).join(' · ')
                  )}
                </div>
              </button>
              {f.ready && f.id && (
                <span className="absolute top-2 right-2 scale-90">
                  <PreviewButton id={f.id} has preview={preview} />
                </span>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
