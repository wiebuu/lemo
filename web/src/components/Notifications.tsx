import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CircleCheck, CloudOff, Crown, HandHeart, Music2, Send, Sparkles, Swords, TriangleAlert, Trophy } from 'lucide-react'
import { notifications, useNotifications, type Note, type NoteKind } from '../state/notifications'
import { studio } from '../state/studio'
import { navigate } from '../pages/router'
import { sfx } from '../lib/sfx'
import { cx, Tip } from './ui'

const ICON: Record<NoteKind, (size: number) => ReactNode> = {
  'song-ready': (s) => <Music2 size={s} />,
  request: (s) => <Send size={s} />,
  analysed: (s) => <CircleCheck size={s} />,
  failed: (s) => <TriangleAlert size={s} />,
  top: (s) => <Crown size={s} />,
  best: (s) => <Trophy size={s} />,
  helped: (s) => <HandHeart size={s} />,
  challenge: (s) => <Swords size={s} />,
  welcome: (s) => <Sparkles size={s} />,
  sync: (s) => <CloudOff size={s} />,
}
const BAD: NoteKind[] = ['failed', 'sync']

function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** What clicking a notification does: open its song or its page. */
function act(n: Note) {
  notifications.markRead(n.id)
  if (n.songId) {
    navigate('/')
    void studio.loadAnalyzed(n.songId).catch(() => {})
  } else if (n.href) navigate(n.href)
}

/** The bell in the header: a dot when something's new, and a short list of what happened. */
export function NotificationBell({ className }: { className?: string }) {
  const { notes, unread } = useNotifications()
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ right: number; top: number; full: boolean } | null>(null)
  const [, tick] = useState(0) // "3 min ago" stays fresh while open

  const close = () => {
    setPos(null)
    sfx.play('collapse', { volume: 0.7 })
    notifications.markAllRead() // seen
  }
  useEffect(() => {
    if (!pos) return
    const out = (e: Event) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) close()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    const t = setInterval(() => tick((x) => x + 1), 30_000)
    window.addEventListener('pointerdown', out, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      clearInterval(t)
      window.removeEventListener('pointerdown', out, true)
      window.removeEventListener('keydown', esc, true)
    }
  })

  const toggle = () => {
    if (pos) return close()
    const r = btn.current!.getBoundingClientRect()
    // phones: the whole width (minus a margin); larger screens: under the bell
    const full = window.innerWidth < 640
    setPos({ right: full ? 12 : Math.max(12, window.innerWidth - r.right - 4), top: r.bottom + 6, full })
    notifications.dismissPopup()
    sfx.play('expand', { volume: 0.7 })
  }

  return (
    <>
      <Tip tip={unread ? `${unread} new` : 'Notifications'}>
        <button ref={btn} type="button" onClick={toggle} aria-label={unread ? `notifications, ${unread} new` : 'notifications'} aria-expanded={!!pos}
          className={cx('relative p-1.5 rounded-md transition-colors shrink-0', pos ? 'text-text' : 'text-sub hover:text-text', className)}>
          <Bell size={16} strokeWidth={1.75} className={cx(unread > 0 && 'bell-ring')} key={unread} />
          {unread > 0 && <span className="badge-pop absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-main" />}
        </button>
      </Tip>
      {pos && createPortal(
        <div ref={panel} role="dialog" aria-label="notifications"
          className={cx('pop-in fixed z-[90] rounded-2xl bg-sub-alt shadow-2xl flex flex-col max-h-[min(60vh,420px)] overflow-hidden', !pos.full && 'w-[19rem]')}
          style={{ right: pos.right, top: pos.top, left: pos.full ? 12 : undefined }}>
          {notes.length === 0 ? (
            <p className="px-4 py-5 text-center text-[12px] text-sub">Nothing new yet</p>
          ) : (
            <>
              <ul className="overflow-y-auto overscroll-contain p-1.5">
                {notes.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => { act(n); if (n.songId || n.href) close() }}
                      className="w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-xl transition-colors hover:bg-bg/60">
                      <span className={cx('shrink-0 mt-[3px]', BAD.includes(n.kind) ? 'text-error' : n.read ? 'text-sub' : 'text-main')}>{ICON[n.kind](13)}</span>
                      <span className="flex-1 min-w-0">
                        <span className={cx('block truncate text-[12.5px] leading-snug', n.read ? 'text-sub' : 'text-text')}>{n.title}</span>
                        <span className="block truncate text-[11px] leading-snug text-sub/80">
                          {n.body ? `${n.body} · ` : ''}{ago(n.at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => { notifications.clear(); sfx.play('delete', { volume: 0.7 }) }}
                className="self-center mb-2 mt-0.5 px-2 py-0.5 rounded-full text-[11px] text-sub/80 hover:text-text">
                clear all
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

/** A notification as it arrives: a small strip at the top for a few seconds. Tap it to put it away. */
export function NotificationPopup() {
  const { popup } = useNotifications()
  if (!popup) return null
  const n = popup
  const go = n.songId || n.href
  const away = () => {
    notifications.markRead(n.id)
    notifications.dismissPopup(n.id)
  }
  return (
    <div role="status" aria-live="polite" key={n.id}
      className="note-in fixed z-[80] top-[max(0.75rem,env(safe-area-inset-top))] inset-x-0 mx-auto w-max max-w-[min(28rem,calc(100vw-1.5rem))]
        flex items-center rounded-full bg-sub-alt shadow-xl text-[12px]">
      <button type="button" onClick={away} aria-label={`${n.title}. Tap to dismiss`}
        className="min-w-0 flex items-center gap-2 pl-3 pr-3 py-1.5 text-left">
        <span className={cx('shrink-0', BAD.includes(n.kind) ? 'text-error' : 'text-main')}>{ICON[n.kind](13)}</span>
        <span className="truncate text-text">{n.title}</span>
      </button>
      {go && (
        <button type="button" onClick={() => { act(n); notifications.dismissPopup(n.id) }}
          className="shrink-0 pr-3.5 pl-1 py-1.5 text-main font-medium">
          {n.songId ? 'sing' : 'open'}
        </button>
      )}
    </div>
  )
}
