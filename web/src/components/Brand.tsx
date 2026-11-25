import { useId } from 'react'
import { cx } from './ui'

/** The mark: a sung line — nothing else. */
export const WAVE_PATH = 'M2 14 C7 14 8 5 13 5 S20 19 26 19 S33 8 38 8 S44 13 46 13'

/** The accent as a left-to-right gradient for an SVG stroke (--main into --main-2: a sheen in the
    calm themes, two colours in the colourful ones). Returns the defs and the paint to use. */
export function useAccentStroke(): [React.ReactNode, string] {
  const id = 'acc' + useId().replace(/:/g, '')
  return [
    <defs key="d">
      <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" style={{ stopColor: 'var(--main)' }} />
        <stop offset="1" style={{ stopColor: 'var(--main-2)' }} />
      </linearGradient>
    </defs>,
    `url(#${id})`,
  ]
}

export function Wave({ className }: { className?: string }) {
  const [defs, paint] = useAccentStroke()
  return (
    <svg viewBox="0 0 48 24" className={cx('overflow-visible', className)} aria-hidden>
      {defs}
      <path d={WAVE_PATH} fill="none" stroke={paint} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** "lemody", with the wave in front. */
export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="flex items-center gap-2 select-none">
      <Wave className={cx('hidden sm:block', size === 'lg' ? 'w-11 h-6' : 'w-8 h-4')} />
      <span className={cx('font-semibold tracking-[-0.03em] leading-none text-text', size === 'lg' ? 'text-[30px]' : 'text-[20px]')}>lemody</span>
    </span>
  )
}

/**
 * The loading screen lives in index.html (#boot): it's on screen before any script loads, and
 * its wave is drawn in a worker so loading can't make it stutter. The app shows and hides it
 * through window.__boot; there's no second copy, so nothing ever jumps or restarts.
 */
type Boot = { whenReady(f: () => void): void; show(): void; hide(): void }
export const boot = (): Boot | undefined => (window as unknown as { __boot?: Boot }).__boot

/** Room for the loading screen while it's up (it covers the page from index.html). */
export function Splash() {
  return <div className="h-dvh bg-bg" />
}
