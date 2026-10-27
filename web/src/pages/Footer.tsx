import { cx } from '../components/ui'
import { go } from './router'

export const FOOTER_LINKS: [string, string][] = [
  ['/about', 'About'],
  ['/help', 'Help'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/contact', 'Contact'],
]

/** About · Help · Privacy · Terms · Contact — and who makes Lemody. */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <nav aria-label="site" className={cx('flex flex-col items-center gap-2 text-[11px] text-sub', className)}>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {FOOTER_LINKS.map(([href, label]) => (
          <a key={href} href={href} onClick={go} className="hover:text-text transition-colors">{label}</a>
        ))}
      </div>
      <a href="https://wiecodes.com" target="_blank" rel="noopener noreferrer" className="group hover:text-text transition-colors">
        © {new Date().getFullYear()} Lemody · <span className="font-semibold tracking-wide text-text/90 group-hover:text-main">Wiecodes</span>
      </a>
    </nav>
  )
}
