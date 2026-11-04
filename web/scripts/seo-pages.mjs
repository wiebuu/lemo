// After `vite build`: a plain, fast page for every song in the library (/sing/…), one
// per artist (/artists/…) and one listing them all (/songs), plus the sitemap with all
// of them. The app itself needs a sign-in, so without these a search engine only ever
// sees the home page. Each page's "sing it" button opens the app on that song (/?song=…).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = 'https://www.lemodysounds.online'
const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist')
const queue = join(here, '..', '..', 'analyzer', 'featured.json')

const LANGS = {
  hi: 'Hindi', pa: 'Punjabi', gw: 'Garhwali', ku: 'Kumaoni', hr: 'Haryanvi', en: 'English', ur: 'Urdu',
  ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', bn: 'Bengali', mr: 'Marathi', ne: 'Nepali', es: 'Spanish',
  fr: 'French', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', ru: 'Russian', ka: 'Georgian',
}

if (!existsSync(queue)) {
  console.log('seo-pages: no analyzer/featured.json here, song pages skipped')
  process.exit(0)
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const slugify = (s) =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
/** the people credited, one by one ("A, B & C feat. D") */
const artistsOf = (a) => (a ?? '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b)\s*/i).map((x) => x.trim()).filter(Boolean)

// ---- the songs: every one in the library (found on YouTube), once
const used = new Set()
const songs = []
for (const it of JSON.parse(readFileSync(queue, 'utf8'))) {
  if (!it?.videoId || !it.title) continue
  const id = `yt-${it.videoId}`
  if (songs.some((s) => s.id === id)) continue
  const people = artistsOf(it.artist)
  let slug = slugify(`${it.title} ${people[0] ?? ''}`) || it.videoId.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  while (used.has(slug)) slug += '-2'
  used.add(slug)
  songs.push({ id, slug, title: it.title, artist: it.artist ?? '', people, lang: LANGS[it.lang] ?? null })
}
songs.sort((a, b) => a.title.localeCompare(b.title))

const artists = new Map()
for (const s of songs)
  for (const name of s.people) {
    const slug = slugify(name)
    if (!slug) continue
    if (!artists.has(slug)) artists.set(slug, { slug, name, songs: [] })
    artists.get(slug).songs.push(s)
  }

const artistLinks = (s) =>
  s.people.map((n) => (slugify(n) ? `<a href="/artists/${slugify(n)}">${esc(n)}</a>` : esc(n))).join(', ')
const songLink = (s) => `<li><a href="/sing/${s.slug}">${esc(s.title)}</a><span>${esc(s.artist)}</span></li>`

function page({ path, title, description, h1, body, jsonld }) {
  const url = `${SITE}${path}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="theme-color" content="#111111">
<meta property="og:site_name" content="Lemody">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/og-image.jpg">
<meta name="twitter:card" content="summary_large_image">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
<style>
:root{--bg:#111;--card:#1a1a1a;--text:#eee;--sub:#8a8a8a;--line:#262626}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:24px 16px 64px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:40px}
.logo{display:flex;align-items:center;gap:10px;color:var(--text);text-decoration:none;font-weight:600;font-size:20px;letter-spacing:-.02em}
.logo svg{width:36px;height:18px}
nav a{color:var(--sub);text-decoration:none;font-size:14px;margin-left:16px}
nav a:hover,a:hover{color:var(--text)}
a{color:var(--text)}
h1{font-size:clamp(28px,6vw,40px);line-height:1.15;letter-spacing:-.03em;margin:0 0 8px}
h2{font-size:18px;margin:40px 0 12px;letter-spacing:-.01em}
.by{color:var(--sub);margin:0 0 24px}
.by a{color:var(--sub)}
.cta{display:inline-block;background:var(--text);color:var(--bg);text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;margin:8px 0 4px}
.cta:hover{color:var(--bg);opacity:.9}
.note{color:var(--sub);font-size:13px}
p{color:#cfcfcf}
ul.songs{list-style:none;padding:0;margin:0;border-top:1px solid var(--line)}
ul.songs li{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}
ul.songs li a{text-decoration:none}
ul.songs li span{color:var(--sub);font-size:14px;text-align:right}
ul.feats{padding-left:18px;color:#cfcfcf}
.tags a{display:inline-block;margin:0 6px 8px 0;padding:4px 12px;border:1px solid var(--line);border-radius:999px;text-decoration:none;font-size:14px;color:var(--sub)}
footer{margin-top:56px;color:var(--sub);font-size:13px}
footer a{color:var(--sub);margin-right:14px}
</style>
</head>
<body>
<div class="wrap">
<header>
<a class="logo" href="/"><svg viewBox="0 0 48 24" aria-hidden="true"><path d="M2 14 C7 14 8 5 13 5 S20 19 26 19 S33 8 38 8 S44 13 46 13" fill="none" stroke="#f0f0f0" stroke-width="2.6" stroke-linecap="round"/></svg>lemody</a>
<nav><a href="/songs">Songs</a><a href="/">Open the app</a></nav>
</header>
<main>
<h1>${h1}</h1>
${body}
</main>
<footer><a href="/songs">All songs</a><a href="/about">About</a><a href="/help">Help</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><br><br>© ${new Date().getFullYear()} Lemody · made by <a href="https://wiecodes.com">Wiecodes</a></footer>
</div>
</body>
</html>
`
}

function write(path, html) {
  const file = join(dist, `${path}.html`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
}

const FEATURES = `<ul class="feats">
<li>Your voice drawn live on the original singer's melody, so you see exactly where you go sharp or flat</li>
<li>Synced lyrics that scroll with the song</li>
<li>Honest scores for pitch, timing and expression after every take</li>
<li>Change the key or slow the song down to practise the hard lines</li>
<li>Free, in your browser: no app to install</li>
</ul>`

// ---- one page per song
for (const s of songs) {
  const same = artists.get(slugify(s.people[0] ?? ''))?.songs.filter((x) => x !== s).slice(0, 12) ?? []
  const more = songs.filter((x) => x !== s && x.lang === s.lang && !same.includes(x))
  const start = (songs.indexOf(s) * 7) % Math.max(1, more.length)
  const also = [...more.slice(start), ...more.slice(0, start)].slice(0, 12)
  const lang = s.lang ? `${s.lang} ` : ''
  write(`sing/${s.slug}`, page({
    path: `/sing/${s.slug}`,
    title: `Sing ${s.title}${s.artist ? ` by ${s.artist}` : ''} · karaoke with live pitch | Lemody`,
    description: `Sing ${s.title}${s.artist ? ` (${s.artist})` : ''} online with synced lyrics and see your pitch live on the original melody. Free ${lang}karaoke and singing practice with honest scores.`,
    h1: `Sing ${esc(s.title)}`,
    body: `<p class="by">${s.people.length ? `by ${artistLinks(s)}` : ''}${s.lang ? ` · ${esc(s.lang)} song` : ''}</p>
<a class="cta" href="/?song=${encodeURIComponent(s.id)}">Sing it now · free</a>
<p class="note">Opens Lemody in your browser. Use headphones for the best result.</p>
<h2>Practise ${esc(s.title)} with live pitch</h2>
<p>Lemody plays ${esc(s.title)}${s.artist ? ` by ${esc(s.artist)}` : ''} with the vocals turned down, shows the lyrics as they come, and draws the original singer's melody on a moving graph. When you sing, your own line appears on top of it, so you can see exactly where your pitch matches and where it drifts. After each take you get a score for pitch, timing and expression.</p>
${FEATURES}
${same.length ? `<h2>More songs by ${esc(s.people[0])}</h2><ul class="songs">${same.map(songLink).join('')}</ul>` : ''}
${also.length ? `<h2>More ${esc(s.lang ?? '')} songs to sing</h2><ul class="songs">${also.map(songLink).join('')}</ul>` : ''}`,
    jsonld: {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'MusicRecording', name: s.title, url: `${SITE}/sing/${s.slug}`, inLanguage: s.lang ?? undefined,
          byArtist: s.people.map((n) => ({ '@type': 'MusicGroup', name: n })) },
        { '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Songs', item: `${SITE}/songs` },
          { '@type': 'ListItem', position: 2, name: s.title, item: `${SITE}/sing/${s.slug}` },
        ] },
      ],
    },
  }))
}

// ---- one page per artist
for (const a of artists.values()) {
  write(`artists/${a.slug}`, page({
    path: `/artists/${a.slug}`,
    title: `${a.name} songs karaoke · sing with live pitch | Lemody`,
    description: `Sing ${a.songs.length} ${a.name} song${a.songs.length > 1 ? 's' : ''} online: ${a.songs.slice(0, 4).map((s) => s.title).join(', ')}${a.songs.length > 4 ? ' and more' : ''}. Free karaoke with synced lyrics and your pitch live on the melody.`,
    h1: `Sing ${esc(a.name)} songs`,
    body: `<p class="by">${a.songs.length} song${a.songs.length > 1 ? 's' : ''} on Lemody</p>
<p>Pick a ${esc(a.name)} song and sing along: the lyrics scroll with the music and your voice is drawn live on the original melody, so you can hear and see how close you are.</p>
<ul class="songs">${a.songs.map(songLink).join('')}</ul>`,
    jsonld: { '@context': 'https://schema.org', '@type': 'MusicGroup', name: a.name, url: `${SITE}/artists/${a.slug}` },
  }))
}

// ---- every song, by language
const byLang = new Map()
for (const s of songs) {
  const k = s.lang ?? 'Other'
  if (!byLang.has(k)) byLang.set(k, [])
  byLang.get(k).push(s)
}
const order = [...byLang.keys()].sort((a, b) => byLang.get(b).length - byLang.get(a).length)
const topArtists = [...artists.values()].sort((a, b) => b.songs.length - a.songs.length).slice(0, 40)
write('songs', page({
  path: '/songs',
  title: `${songs.length}+ songs to sing online · Hindi, Punjabi, Garhwali, English karaoke | Lemody`,
  description: `Sing ${songs.length}+ songs with synced lyrics and see your pitch live on the melody: Bollywood, Punjabi, Garhwali, Haryanvi and English hits. Free online karaoke and singing practice.`,
  h1: 'Songs you can sing on Lemody',
  body: `<p class="by">${songs.length} songs · new ones added every week</p>
<a class="cta" href="/">Open Lemody</a>
<h2>Popular artists</h2>
<p class="tags">${topArtists.map((a) => `<a href="/artists/${a.slug}">${esc(a.name)}</a>`).join('')}</p>
${order.map((k) => `<h2 id="${slugify(k)}">${esc(k)} songs</h2><ul class="songs">${byLang.get(k).map(songLink).join('')}</ul>`).join('\n')}`,
  jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Songs on Lemody', url: `${SITE}/songs` },
}))

// ---- the sitemap: the site's own pages, then all of the above
const today = new Date().toISOString().slice(0, 10)
const url = (path, freq, pri) => `  <url><loc>${SITE}${path}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${pri}</priority></url>`
writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[
  url('/', 'weekly', '1.0'),
  url('/songs', 'weekly', '0.9'),
  ...['/about', '/help'].map((p) => url(p, 'monthly', '0.5')),
  ...['/privacy', '/terms', '/contact'].map((p) => url(p, 'yearly', '0.2')),
  ...songs.map((s) => url(`/sing/${s.slug}`, 'monthly', '0.8')),
  ...[...artists.values()].map((a) => url(`/artists/${a.slug}`, 'weekly', '0.6')),
].join('\n')}
</urlset>
`)

console.log(`seo-pages: ${songs.length} songs, ${artists.size} artists, sitemap written`)
