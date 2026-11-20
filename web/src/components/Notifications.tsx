import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CheckCheck, CircleCheck, CloudOff, Crown, HandHeart, Music2, Send, Sparkles, Swords, Trash2, TriangleAlert, Trophy, X } from 'lucide-react'
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

function NoteIcon({ kind, size = 15 }: { kind: NoteKind; size?: number }) {
  return (
    <span className={cx('shrink-0 w-7 h-7 rounded-full flex items-center justify-center',
      BAD.includes(kind) ? 'bg-error/15 text-error' : 'bg-main/15 text-main')}>
      {ICON[kind](size)}
    </span>
  )
}

/** The bell in the header: unread count, and the list of everything that happened. */
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
    setPos({ right: full ? 12 : Math.max(12, window.innerWidth - r.right - 8), top: r.bottom + 8, full })
    notifications.dismissPopup()
    sfx.play('expand', { volume: 0.7 })
  }

  return (
    <>
      <Tip tip={unread ? `${unread} new` : 'Notifications'}>
        <button ref={btn} type="button" onClick={toggle} aria-label={unread ? `notifications, ${unread} new` : 'notifications'} aria-expanded={!!pos}
          className={cx('relative p-1.5 rounded-md transition-colors shrink-0', pos ? 'text-main' : 'text-sub hover:text-text', className)}>
          <Bell size={17} className={cx(unread > 0 && 'bell-ring')} key={unread} />
          {unread > 0 && (
            <span className="badge-pop absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-main text-bg text-[9px] font-semibold leading-[15px] text-center tabular-nums">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </Tip>
      {pos && createPortal(
        <div ref={panel} role="dialog" aria-label="notifications"
          className={cx('pop-in fixed z-[90] modal-card rounded-xl shadow-2xl border border-line flex flex-col max-h-[min(70vh,520px)]', !pos.full && 'w-[22rem]')}
          style={{ right: pos.right, top: pos.top, left: pos.full ? 12 : undefined }}>
          <div className="flex items-center gap-1 px-3.5 pt-3 pb-2 border-b border-line">
            <h2 className="flex-1 text-sm font-semibold tracking-tight text-text">notifications</h2>
            {unread > 0 && (
              <button type="button" onClick={() => { notifications.markAllRead(); sfx.play('check') }}
                className="text-[11px] text-sub hover:text-text inline-flex items-center gap-1 px-1.5 py-1 rounded-md">
                <CheckCheck size={13} /> mark read
              </button>
            )}
            {notes.length > 0 && (
              <Tip tip="Clear all">
                <button type="button" aria-label="clear all" onClick={() => { notifications.clear(); sfx.play('delete') }}
                  className="text-sub hover:text-text p-1.5 rounded-md"><Trash2 size={13} /></button>
              </Tip>
            )}
          </div>
          {notes.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Bell size={22} className="mx-auto text-sub/60" />
              <div className="text-sm text-text mt-3">Nothing new</div>
              <p className="text-[11px] text-sub mt-1 leading-snug">When a song you asked for is added, your take makes today’s top, or you beat your best, it shows up here.</p>
            </div>
          ) : (
            <ul className="overflow-y-auto overscroll-contain py-1">
              {notes.map((n) => (
                <li key={n.id} className="group relative">
                  <button type="button" onClick={() => { act(n); if (n.songId || n.href) close() }}
                    className={cx('w-full text-left flex gap-3 px-3.5 py-2.5 transition-colors hover:bg-bg/50', !n.read && 'bg-main/[0.04]')}>
                    <NoteIcon kind={n.kind} />
                    <span className="flex-1 min-w-0 pr-4">
                      <span className={cx('block text-[13px] leading-snug', n.read ? 'text-sub' : 'text-text font-medium')}>{n.title}</span>
                      {n.body && <span className="block text-[11px] text-sub leading-snug mt-0.5">{n.body}</span>}
                      <span className="block text-[10px] text-sub/70 mt-1 tracking-wide">{ago(n.at)}</span>
                    </span>
                  </button>
                  {!n.read && <span className="absolute right-3.5 top-3.5 w-1.5 h-1.5 rounded-full bg-main pointer-events-none group-hover:opacity-0" />}
                  <button type="button" aria-label="remove" onClick={() => { notifications.remove(n.id); sfx.play('delete', { volume: 0.6 }) }}
                    className="absolute right-2 top-2 p-1 rounded-md text-sub hover:text-text opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(pointer:coarse)]:opacity-60">
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
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
        flex items-center rounded-full modal-card border border-line shadow-lg text-[12px]">
      <button type="button" onClick={away} aria-label={`${n.title}. Tap to dismiss`}
        className="min-w-0 flex items-center gap-2 pl-3 pr-3 py-1.5 text-left">
        <span className={cx('shrink-0', BAD.includes(n.kind) ? 'text-error' : 'text-main')}>{ICON[n.kind](13)}</span>
        <span className="truncate text-text">{n.title}</span>
      </button>
      {go && (
        <button type="button" onClick={() => { act(n); notifications.dismissPopup(n.id) }}
          className="shrink-0 pr-3 pl-2 py-1.5 border-l border-line text-main font-medium">
          {n.songId ? 'sing' : 'open'}
        </button>
      )}
    </div>
  )
}
