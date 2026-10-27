import { cx } from './ui'

/** "Lemody · Wiecodes", linking to wiecodes.com. */
export function WiecodesCredit({ withName = true, className }: { withName?: boolean; className?: string }) {
  return (
    <a
      href="https://wiecodes.com"
      target="_blank"
      rel="noopener noreferrer"
      className={cx('group inline-flex items-center gap-1 text-[11px] text-sub hover:text-text transition-colors', className)}
    >
      {withName && (
        <>
          <span className="text-text/80 font-medium">Lemody</span>
          <span aria-hidden className="mx-0.5">·</span>
        </>
      )}
      <span className="font-semibold tracking-wide text-text/90 group-hover:text-main transition-colors">Wiecodes</span>
    </a>
  )
}
