import { cx } from './ui'

/** The mark: a sung line — nothing else. */
export const WAVE_PATH = 'M2 14 C7 14 8 5 13 5 S20 19 26 19 S33 8 38 8 S44 13 46 13'

/**
 * Every loading animation runs on one clock that starts when the page opens (index.html's
 * loading screen does the same), so React taking over never makes the wave jump.
 * Worked out once: a new delay on a re-render would restart the animation mid-sweep.
 */
let delay: string | null = null
const loadingDelay = () => (delay ??= `-${Math.round(performance.now())}ms`)

export function Wave({ className, draw }: { className?: string; /** sweeps in and out (loading) */ draw?: boolean }) {
  const svg = (
    <svg viewBox="0 0 48 24" className={cx('overflow-visible', draw ? undefined : className)} aria-hidden>
      <path d={WAVE_PATH} fill="none" stroke="var(--main)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  if (!draw) return svg
  return (
    <span className="wave-reveal" style={{ animationDelay: loadingDelay() }}>
      <span>{svg}</span>
    </span>
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
 * The loading screen: the wave draws itself while Lemody gets ready.
 * index.html shows the same thing (plain HTML) before any script has loaded, so
 * the hand-over is seamless.
 */
export function Splash({ label }: { label?: string }) {
  return (
    <div className="h-dvh flex flex-col items-center justify-center px-6" role="status" aria-live="polite">
      <div className="flex flex-col items-center">
        <Wave draw />
        <div className="mt-5 text-[28px] font-semibold tracking-[-0.03em] leading-none text-text">lemody</div>
        <div className="mt-6 h-[2px] w-28 rounded-full bg-sub-alt overflow-hidden">
          <div className="busy-indeterminate h-full w-1/3 rounded-full bg-main" style={{ animationDelay: loadingDelay() }} />
        </div>
        <div className="mt-3 h-4 text-[11px] text-sub">{label ?? ''}</div>
      </div>
      <div className="fixed bottom-0 inset-x-0 flex justify-center pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[11px] text-sub">
        <span className="font-semibold tracking-wide text-text/80">Wiecodes</span>
      </div>
    </div>
  )
}
