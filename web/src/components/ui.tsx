import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { studio, type Snapshot } from '../state/studio'

/** A phone-sized screen (below Tailwind's sm breakpoint); follows rotation and resizing. */
const PHONE = '(max-width: 639px)'
export function usePhone(): boolean {
  return useSyncExternalStore(
    (fn) => { const m = matchMedia(PHONE); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn) },
    () => matchMedia(PHONE).matches,
  )
}

export function useStudio(): Snapshot {
  return useSyncExternalStore(studio.subscribe, studio.getSnapshot)
}

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

/** Text-style button: sub colour, brightens on hover, main when active. */
export function TBtn({
  active, disabled, onClick, children, title, className,
}: {
  active?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode; title?: string; className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'transition-colors duration-150 disabled:opacity-35 whitespace-nowrap',
        active ? 'text-main' : 'text-sub hover:text-text',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function IconBtn({
  onClick, title, children, active, disabled, className,
}: {
  onClick?: () => void; title: string; children: ReactNode; active?: boolean; disabled?: boolean; className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'p-2 rounded-md transition-colors duration-150 disabled:opacity-35',
        active ? 'text-main' : 'text-sub hover:text-text',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Divider() {
  return <span className="w-[3px] h-4 rounded bg-bg shrink-0" />
}

export function Modal({ title, onClose, children, wide, tabs }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean; tabs?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const overlay = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const drag = useSheetDrag(sheet, overlay, onClose)
  return (
    <div
      ref={overlay}
      className="overlay-in fixed inset-0 z-50 bg-black/55 flex items-end sm:items-center justify-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Never taller than the screen: header stays put, only the content scrolls.
          Phones: a sheet from the bottom edge (drag the top of it down to close); larger screens: a centred card. */}
      <div ref={sheet} className={cx('modal-in sheet-in modal-card w-full rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[88dvh] sm:max-h-[min(86vh,780px)] pb-[env(safe-area-inset-bottom)] sm:pb-0', wide ? 'sm:max-w-3xl' : 'sm:max-w-xl')}>
        <div {...drag} className="sm:hidden shrink-0 pt-2 pb-1 -mb-1 touch-none cursor-grab" aria-hidden>
          <div className="mx-auto h-1 w-10 rounded-full bg-sub/40" />
        </div>
        <div {...drag} className="flex items-center justify-between px-5 sm:px-7 pt-3 sm:pt-4 pb-2 shrink-0 touch-none sm:touch-auto">
          <h2 className="text-base font-semibold tracking-tight text-text">{title}</h2>
          <IconBtn title="close (esc)" onClick={onClose}>
            <X size={16} />
          </IconBtn>
        </div>
        {tabs && <div className="px-5 sm:px-7 pb-3 shrink-0">{tabs}</div>}
        <div className="modal-body min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-7 pb-6">{children}</div>
      </div>
    </div>
  )
}

/**
 * Phones: drag a sheet down by its top to close it. The sheet follows the finger (moved
 * directly, no re-render, so it's smooth) and the backdrop fades with it; let go past a
 * third of its height — or flick it down — and it slides away and closes, otherwise it
 * springs back. A tap (no movement) still reaches the buttons.
 */
function useSheetDrag(sheet: React.RefObject<HTMLDivElement | null>, overlay: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  const st = useRef<{ id: number; y0: number; dy: number; t: number; v: number; on: boolean } | null>(null)
  const set = (dy: number, animate: boolean) => {
    const el = sheet.current
    if (!el) return
    el.style.transition = animate ? 'transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none'
    el.style.transform = dy ? `translateY(${dy}px)` : ''
    const o = overlay.current
    if (o) {
      o.style.transition = animate ? 'background-color 0.24s ease-out' : 'none'
      o.style.backgroundColor = `rgba(0, 0, 0, ${0.55 * Math.max(0, 1 - dy / Math.max(1, el.offsetHeight))})`
    }
  }
  const end = (e: React.PointerEvent) => {
    const d = st.current
    st.current = null
    if (!d?.on || !sheet.current) return
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(d.id)
    } catch {
      /* already released */
    }
    const h = sheet.current.offsetHeight
    if (d.dy > h / 3 || d.v > 0.6) {
      set(h + 40, true) // slide away, then close
      window.setTimeout(onClose, 220)
    } else set(0, true)
  }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' || !matchMedia('(max-width: 639px)').matches) return
      st.current = { id: e.pointerId, y0: e.clientY, dy: 0, t: e.timeStamp, v: 0, on: false }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = st.current
      if (!d || e.pointerId !== d.id) return
      const dy = Math.max(0, e.clientY - d.y0)
      if (!d.on) {
        if (dy < 6) return // still a tap
        d.on = true
        ;(e.currentTarget as HTMLElement).setPointerCapture(d.id)
      }
      const dt = Math.max(1, e.timeStamp - d.t)
      d.v = 0.7 * d.v + 0.3 * ((dy - d.dy) / dt) // px per ms, smoothed
      d.dy = dy
      d.t = e.timeStamp
      set(dy, false)
    },
    onPointerUp: end,
    onPointerCancel: end,
  }
}

/** A settings row: title and explanation on top, controls underneath — never squeezed side by side. */
export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="py-4 border-b border-sub-alt last:border-0">
      <div className="text-text text-sm">{title}</div>
      {hint && <p className="text-sub text-xs mt-1 leading-relaxed">{hint}</p>}
      <div className="flex flex-wrap items-center gap-2 mt-3">{children}</div>
    </div>
  )
}

/** Small segmented tabs (used at the top of dialogs). */
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 surface rounded-full p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cx('flex-1 px-3 py-1 rounded-full text-xs transition-colors whitespace-nowrap', value === o.value ? 'bg-bg text-text font-medium' : 'text-sub hover:text-text')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Choice<T extends string | number>({
  value, options, onChange,
}: {
  value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void
}) {
  return (
    <>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-35',
            o.value === value ? 'bg-main text-bg font-medium' : 'surface text-text hover:text-main',
          )}
        >
          {o.label}
        </button>
      ))}
    </>
  )
}

export function Btn({ onClick, children, disabled, primary, className, title }: {
  onClick?: () => void; children: ReactNode; disabled?: boolean; primary?: boolean; className?: string; title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'px-3.5 py-1.5 rounded-full text-xs transition-all disabled:opacity-35 inline-flex items-center gap-2 active:scale-[.97]',
        primary ? 'bg-main text-bg font-medium hover:brightness-110' : 'surface text-text hover:text-main hover:border-main/30',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="bg-sub-alt text-sub rounded px-1.5 py-0.5 text-[10px] font-mono">{children}</kbd>
}

/**
 * Hover / focus tooltip. Rendered in a portal with fixed positioning so it is
 * never clipped by scrolling containers, and kept inside the viewport.
 * `preview` shows a small picture of what the control does, above the text.
 */
export function Tip({ tip, children, className, wide, preview }: {
  tip: ReactNode; children: ReactNode; className?: string; wide?: boolean; preview?: ReactNode
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Touch screens have no hover: a tap just acts, a long-press shows the tip.
  const touchAt = useRef(0)
  const press = useRef<{ x: number; y: number } | null>(null)
  const longPressed = useRef(false)
  const place = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const above = r.bottom + (preview ? 170 : 90) > window.innerHeight
    setPos({ x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above })
  }
  const show = () => {
    if (Date.now() - touchAt.current < 1000) return // the browser's fake hover after a tap
    clearTimeout(timer.current)
    timer.current = setTimeout(place, 220)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setPos(null)
  }
  const onPointerDown = (e: React.PointerEvent) => {
    hide()
    if (e.pointerType === 'mouse') return
    touchAt.current = Date.now()
    longPressed.current = false
    press.current = { x: e.clientX, y: e.clientY }
    timer.current = setTimeout(() => {
      longPressed.current = true
      place()
      timer.current = setTimeout(() => setPos(null), 2800)
    }, 450)
  }
  const cancelPress = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || !press.current) return
    if (e.type === 'pointermove' && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) < 10) return
    press.current = null
    if (!longPressed.current) clearTimeout(timer.current)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <span ref={ref} className={cx('inline-flex', className)} onMouseEnter={show} onMouseLeave={hide} onFocus={() => Date.now() - touchAt.current > 1000 && show()} onBlur={hide}
      onPointerDown={onPointerDown} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerMove={cancelPress}
      onContextMenu={(e) => Date.now() - touchAt.current < 1500 && e.preventDefault()}
      onClickCapture={(e) => {
        // a long-press was for reading the tip, not for pressing the button
        if (longPressed.current) {
          e.preventDefault()
          e.stopPropagation()
          longPressed.current = false
        }
      }}>
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            className={cx(
              'tip-in pointer-events-none fixed z-[100] rounded-lg bg-text text-bg text-xs leading-snug shadow-xl',
              preview ? 'w-56 p-1.5' : wide ? 'w-72 px-3 py-2' : 'w-max max-w-64 px-3 py-2',
            )}
            style={{
              left: Math.min(Math.max(pos.x, 150), window.innerWidth - 150),
              top: pos.y,
              transform: `translate(-50%, ${pos.above ? '-100%' : '0'})`,
            }}
          >
            {preview && <span className="block rounded-md bg-bg p-2 mb-1.5">{preview}</span>}
            <span className={cx('block', !!preview && 'px-1.5 pb-0.5')}>{tip}</span>
          </span>,
          document.body,
        )}
    </span>
  )
}

/**
 * Icon-only toggle with a tooltip — the default control style in lemo.
 * When disabled, hovering explains *why* (`why`) instead of looking broken.
 */
export function IconToggle({
  tip, active, disabled, onClick, children, why, preview,
}: {
  tip: ReactNode; active?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode; why?: string; preview?: ReactNode
}) {
  return (
    <Tip tip={disabled && why ? why : tip} preview={disabled && why ? undefined : preview}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-pressed={active}
        className={cx(
          'p-1.5 rounded-md transition-all duration-200 disabled:opacity-30 flex items-center gap-1 active:scale-90',
          active ? 'text-main' : 'text-sub hover:text-text',
        )}
      >
        {children}
      </button>
    </Tip>
  )
}

/** Plain-language description of a pitch distance for beginners (100 cents = one piano key). */
export function centsInWords(c: number | null): string {
  if (c === null) return '—'
  const a = Math.abs(c)
  if (a < 15) return 'spot on'
  if (a < 35) return 'a tiny bit off'
  if (a < 70) return 'about half a piano key off'
  if (a < 130) return 'about one piano key off'
  return `about ${Math.round(a / 100)} piano keys off`
}

/** Click-to-open menu anchored to its button (portal, so it's never clipped). */
export function Menu({ button, tip, children, active, disabled, buttonClassName }: {
  button: ReactNode
  tip: ReactNode
  /** Content, or a function receiving close() so a choice can dismiss the menu. */
  children: ReactNode | ((close: () => void) => ReactNode)
  active?: boolean
  disabled?: boolean
  buttonClassName?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // y: the panel's top edge, or (up) its bottom edge measured from the bottom of the screen
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null)
  useEffect(() => {
    if (!pos) return
    const close = (e: Event) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !ref.current?.contains(t)) setPos(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [pos])
  const toggle = () => {
    if (pos) return setPos(null)
    const r = ref.current!.getBoundingClientRect()
    // a button low on the screen (the player bar on phones) opens its menu upwards, so it stays on screen
    const up = r.top > window.innerHeight / 2
    setPos({ x: r.left + r.width / 2, y: up ? window.innerHeight - r.top + 8 : r.bottom + 8, up })
  }
  return (
    <>
      <Tip tip={tip}>
        <button ref={ref} type="button" onClick={toggle} aria-expanded={!!pos} disabled={disabled}
          className={cx('p-1.5 rounded-md transition-colors disabled:opacity-30', pos || active ? 'text-main' : 'text-sub hover:text-text', buttonClassName)}>
          {button}
        </button>
      </Tip>
      {pos &&
        createPortal(
          <div ref={panel} className="pop-in fixed z-[90] modal-card rounded-xl p-3 shadow-2xl border border-line w-64"
            style={{ left: Math.min(Math.max(pos.x, 136), window.innerWidth - 136), ...(pos.up ? { bottom: pos.y } : { top: pos.y }), transform: 'translateX(-50%)' }}>
            {typeof children === 'function' ? children(() => setPos(null)) : children}
          </div>,
          document.body,
        )}
    </>
  )
}

/** One row in a Menu: icon + label, with a tooltip for the details. */
export function MenuItem({ icon, label, tip, active, onClick, disabled, preview }: {
  icon: ReactNode; label: string; tip: ReactNode; active?: boolean; onClick: () => void; disabled?: boolean; preview?: ReactNode
}) {
  return (
    <Tip tip={tip} className="w-full" preview={preview}>
      <button type="button" onClick={onClick} disabled={disabled}
        className={cx('w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs transition-colors disabled:opacity-30',
          active ? 'text-main bg-bg/60' : 'text-sub hover:text-text hover:bg-bg/40')}>
        {icon}
        <span>{label}</span>
      </button>
    </Tip>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wider text-sub/70 px-2 pt-2 pb-1 first:pt-0">{children}</div>
}

/** Little equaliser — the loading indicator. */
export function Eq() {
  return (
    <span className="eq" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  )
}

/** What's loading, with a real progress bar when the work can be measured. */
export function BusyCard({ label, progress, detail }: { label: string; progress: number | null; detail: string | null }) {
  const pct = progress === null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100)
  return (
    <div className="fade-in w-72 max-w-[85vw] rounded-xl modal-card px-5 py-4 shadow-2xl" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-text font-medium truncate">{label}</span>
        {pct !== null && <span className="text-xs text-sub tabular-nums font-mono">{pct}%</span>}
      </div>
      <div className="mt-3 h-1 rounded-full bg-sub-alt overflow-hidden">
        {pct === null ? (
          <div className="busy-indeterminate h-full w-1/3 rounded-full bg-main" />
        ) : (
          <div className="h-full rounded-full bg-main transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className="mt-2 text-[11px] text-sub truncate h-4">{detail ?? ''}</div>
    </div>
  )
}
