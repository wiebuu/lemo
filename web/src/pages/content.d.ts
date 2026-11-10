export interface Article {
  path: string
  title: string
  seoTitle: string
  description: string
  kind: 'site' | 'guide' | 'landing'
  html: string
  dated?: boolean
  faq?: [string, string][]
}
export const SITE: string
export const EMAIL: string
export const UPDATED: string
export const UPDATED_ISO: string
export const ARTICLES: Article[]
export const GUIDES: Article[]
export const KARAOKE_LANGS: Record<string, { slug: string; intro: string }>
export const FOOTER: [string, string][]
