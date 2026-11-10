import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Wordmark } from '../components/Brand'

import { SiteFooter } from './Footer'
import { StatsPage, TopPage } from './Board'
import { ComingPage } from './Coming'
import { go, navigate } from './router'
import { ARTICLES, SITE, UPDATED, type Article } from './content.js'

export const PAGES: Record<string, { title: string; seoTitle?: string; description?: string; body: () => ReactNode; /** smaller text and spacing on phones (lists and numbers, not reading) */ compact?: boolean }> = {
  '/top': { title: 'Today’s top', body: TopPage, compact: true },
  '/stats': { title: 'Stats', body: StatsPage, compact: true },
  '/coming': { title: 'Coming soon', body: ComingPage, compact: true },
}
for (const a of ARTICLES) PAGES[a.path] = { title: a.title, seoTitle: a.seoTitle, description: a.description, body: () => <ArticleBody article={a} /> }

/** While a page is open: its own title, description and canonical address (put back on leaving). */
function useHead(path: string, page: (typeof PAGES)[string] | undefined) {
  useEffect(() => {
    const desc = document.querySelector<HTMLMetaElement>('meta[name=description]')
    const canon = document.querySelector<HTMLLinkElement>('link[rel=canonical]')
    const before = { title: document.title, desc: desc?.content, canon: canon?.href }
    document.title = page ? (page.seoTitle ?? `${page.title} · Lemody`) : 'Page not found · Lemody'
    if (desc && page?.description) desc.content = page.description
    if (canon) canon.href = SITE + path
    return () => {
      document.title = before.title
      if (desc && before.desc) desc.content = before.desc
      if (canon && before.canon) canon.href = before.canon
    }
  }, [path, page])
}

/** A site page, over the app (which keeps running underneath). Unknown addresses get a friendly 404. */
export function SitePage({ path }: { path: string }) {
  const page = PAGES[path]
  const scroller = useRef<HTMLDivElement>(null)
  useHead(path, page)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [path])
  useEffect(() => {
    // Esc leaves the page — unless a popup on it is open (that one closes instead)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[data-page-dialog]') && navigate('/')
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div ref={scroller} className="page-in fixed inset-0 z-[70] bg-bg overflow-y-auto overscroll-contain">
      <div className="max-w-2xl mx-auto px-4 sm:px-8 min-h-full flex flex-col">
        <header className="flex items-center gap-3 pt-[max(1.25rem,calc(env(safe-area-inset-top)-0.5rem))] pb-3 sticky top-0 bg-bg/90 backdrop-blur z-10">
          <a href="/" onClick={go} aria-label="Lemody home"><Wordmark /></a>
          <span className="flex-1" />
          <a href="/" onClick={go} className="flex items-center gap-1.5 text-xs text-sub hover:text-text rounded-full surface px-3 py-1.5">
            <ArrowLeft size={13} /> back to singing
          </a>
        </header>
        <main className={page?.compact ? 'flex-1 py-4 sm:py-12' : 'flex-1 py-8 sm:py-12'}>
          {page ? (
            <article className={page.compact ? 'prose-lemody prose-compact' : 'prose-lemody'}>
              <h1>{page.title}</h1>
              <page.body />
            </article>
          ) : (
            <div className="text-center py-16">
              <div className="text-5xl font-semibold text-text tracking-tight">404</div>
              <p className="mt-3 text-sub text-sm">This page doesn't exist — maybe the link was mistyped.</p>
              <a href="/" onClick={go} className="inline-block mt-6 rounded-full bg-main text-bg text-sm font-medium px-5 py-2">Go to Lemody</a>
            </div>
          )}
        </main>
        <SiteFooter className="pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 border-t border-line" />
      </div>
    </div>
  )
}


/** A reading page from content.js. Links to other pages here open in place; the rest load normally. */
function ArticleBody({ article }: { article: Article }) {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href')
    if (!a || !href || !(href === '/' || PAGES[href])) return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(href)
  }
  return (
    <>
      {article.dated && <p className="updated">Last updated {UPDATED}</p>}
      {/* our own static text (content.js), not user input */}
      <div onClick={onClick} dangerouslySetInnerHTML={{ __html: article.html }} />
    </>
  )
}
