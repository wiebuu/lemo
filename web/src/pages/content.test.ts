import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ARTICLES, FOOTER, KARAOKE_LANGS } from './content.js'

const paths = new Set(ARTICLES.map((a) => a.path))
const langPaths = new Set(Object.values(KARAOKE_LANGS).map((l) => `/karaoke/${l.slug}`))
const appPaths = new Set(['/', '/songs', '/top', '/stats', '/coming'])

describe('reading pages', () => {
  it('have unique paths, a title and a description that fits a search result', () => {
    expect(paths.size).toBe(ARTICLES.length)
    for (const a of ARTICLES) {
      expect(a.title, a.path).toBeTruthy()
      expect(a.seoTitle.length, a.path).toBeLessThanOrEqual(80)
      expect(a.description.length, a.path).toBeGreaterThan(70)
      expect(a.description.length, a.path).toBeLessThanOrEqual(170)
    }
  })

  it('only link to pages that exist', () => {
    for (const a of ARTICLES)
      for (const [, href] of a.html.matchAll(/href="(\/[^"]*)"/g))
        expect(paths.has(href) || langPaths.has(href) || appPaths.has(href), `${a.path} → ${href}`).toBe(true)
  })

  it('are all reachable from the footer or the guides page', () => {
    const guides = ARTICLES.find((a) => a.path === '/guides')!.html
    for (const a of ARTICLES)
      expect(FOOTER.some(([href]) => href === a.path) || guides.includes(`href="${a.path}"`), a.path).toBe(true)
  })

  it('are in the sitemap the dev server serves', () => {
    const sitemap = readFileSync(new URL('../../public/sitemap.xml', import.meta.url), 'utf8')
    for (const a of ARTICLES) expect(sitemap, a.path).toContain(`<loc>https://www.lemodysounds.online${a.path}</loc>`)
  })

  it('the privacy policy covers ads, cookies, sign-in and your rights', () => {
    const p = ARTICLES.find((a) => a.path === '/privacy')!.html
    for (const w of ['AdSense', 'cookies', 'Firebase', 'adssettings.google.com', 'Your rights', 'deleted']) expect(p).toContain(w)
  })
})
