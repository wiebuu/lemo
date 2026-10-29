import { cx } from '../components/ui'
import { go } from './router'

export const FOOTER_LINKS: [string, string][] = [
  ['/top', 'Today’s top'],
  ['/stats', 'Stats'],
  ['/coming', 'Coming soon'],
  ['/about', 'About'],
  ['/help', 'Help'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/contact', 'Contact'],
]

/** About · Help · Privacy · Terms · Contact — and who makes Lemody. */
export function SiteFooter({ className }: { className?: string }) {
  return (
    // phones: one thin line (links, then the credit); bigger screens: two lines
    <nav aria-label="site" className={cx('flex flex-wrap sm:flex-col items-center justify-center gap-x-3 gap-y-1 sm:gap-2 text-[10.5px] sm:text-[11px] text-sub', className)}>
      <div className="contents sm:flex sm:flex-wrap sm:justify-center sm:gap-x-4 sm:gap-y-1">
        {FOOTER_LINKS.map(([href, label]) => (
          <a key={href} href={href} onClick={go} className="hover:text-text transition-colors">{label}</a>
        ))}
      </div>
      <a href="https://wiecodes.com" target="_blank" rel="noopener noreferrer" className="group hover:text-text transition-colors">
        <span className="hidden sm:inline">© {new Date().getFullYear()} Lemody · </span>
        <span className="font-semibold tracking-wide text-text/90 group-hover:text-main">Wiecodes</span>
      </a>
    </nav>
  )
}
