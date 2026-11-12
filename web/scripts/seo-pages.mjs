// After `vite build`: plain, fast static pages that search engines (and ad reviewers) can
// read without running the app:
//   - the reading pages (about, help, policies, guides, landing pages) from src/pages/content.js
//   - one page per song in the library (/sing/…), per artist (/artists/…), per language
//     (/karaoke/…) and one listing them all (/songs)
//   - the sitemap with all of them.
// The app opens the same reading pages over itself when you navigate inside it. Each song
// page's "sing it" button opens the app on that song (/?song=…).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARTICLES, FOOTER, KARAOKE_LANGS, SITE, UPDATED, UPDATED_ISO } from '../src/pages/content.js'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist')
const queue = join(here, '..', '..', 'analyzer', 'featured.json')
// Lemody's own YouTube Shorts per song ({ "yt-<id>": [{ short, date }] }); a song page shows the
// ones already published on the day of the build
const SHORTS = existsSync(join(here, 'shorts.json')) ? JSON.parse(readFileSync(join(here, 'shorts.json'), 'utf8')) : {}
const TODAY = new Date().toISOString().slice(0, 10)
const shortsOf = (id) => (SHORTS[id] ?? []).filter((x) => x.date <= TODAY)

const LANGS = {
  hi: 'Hindi', pa: 'Punjabi', gw: 'Garhwali', ku: 'Kumaoni', hr: 'Haryanvi', en: 'English', ur: 'Urdu',
  ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', bn: 'Bengali', mr: 'Marathi', ne: 'Nepali', es: 'Spanish',
  fr: 'French', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', ru: 'Russian', ka: 'Georgian',
  de: 'German', id: 'Indonesian',
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const slugify = (s) =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
/** the people credited, one by one ("A, B & C feat. D") */
const artistsOf = (a) => (a ?? '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b)\s*/i).map((x) => x.trim()).filter(Boolean)

const ORG = { '@type': 'Organization', name: 'Wiecodes', url: 'https://wiecodes.com' }
const crumbs = (...items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE}${path}` })),
})
const faqLd = (faq) => ({
  '@type': 'FAQPage',
  mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
})

function page({ path, title, description, h1, body, jsonld, type = 'website' }) {
  const url = `${SITE}${path}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#111111">
<meta property="og:site_name" content="Lemody">
<meta property="og:type" content="${type}">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="en_IN">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/og-image.jpg">
${jsonld ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [].concat(jsonld) }).replace(/</g, '\\u003c')}</script>` : ''}
<style>
:root{--bg:#111;--card:#1a1a1a;--text:#eee;--sub:#8a8a8a;--line:#262626}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:24px 16px 64px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:40px}
.logo{display:flex;align-items:center;gap:10px;color:var(--text);text-decoration:none;font-weight:600;font-size:20px;letter-spacing:-.02em}
.logo svg{width:36px;height:18px}
nav a{color:var(--sub);text-decoration:none;font-size:14px;margin-left:16px}
nav a:hover,a:hover{color:var(--text)}
a{color:var(--text);text-underline-offset:3px}
h1{font-size:clamp(28px,6vw,40px);line-height:1.15;letter-spacing:-.03em;margin:0 0 16px}
h2{font-size:18px;margin:36px 0 10px;letter-spacing:-.01em}
p,li{color:#cfcfcf}
li{margin:6px 0}
b{color:var(--text);font-weight:600}
.lead{color:var(--text);font-size:18px;opacity:.92}
.updated{color:var(--sub);font-size:13px}
.by{color:var(--sub);margin:0 0 24px}
.by a{color:var(--sub)}
.cta,.button{display:inline-block;background:var(--text);color:var(--bg);text-decoration:none;font-weight:600;padding:11px 22px;border-radius:999px;margin:8px 0 4px}
.cta:hover,.button:hover{color:var(--bg);opacity:.9}
.note{color:var(--sub);font-size:13px}
.short{width:100%;max-width:300px;aspect-ratio:9/16;margin:12px 0;border-radius:14px;overflow:hidden;background:#000}
.short iframe{width:100%;height:100%;border:0;display:block}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin:20px 0}
.card-title{font-weight:600}
.faq{margin:16px 0 28px;border-top:1px solid var(--line)}
details{border-bottom:1px solid var(--line)}
summary{cursor:pointer;font-weight:500;padding:14px 0;list-style:none}
summary::-webkit-details-marker{display:none}
details p{margin:0 0 14px}
ul.songs,ul.guide-list{list-style:none;padding:0;margin:0;border-top:1px solid var(--line)}
ul.songs li{display:flex;justify-content:space-between;gap:12px;padding:9px 0;margin:0;border-bottom:1px solid var(--line)}
ul.songs li a,.guide-list a{text-decoration:none}
ul.songs li span{color:var(--sub);font-size:14px;text-align:right}
.guide-list li{padding:12px 0;margin:0;border-bottom:1px solid var(--line)}
.guide-list a{font-weight:600}
.guide-list span{display:block;color:var(--sub);font-size:14px}
.tags a{display:inline-block;margin:0 6px 8px 0;padding:4px 12px;border:1px solid var(--line);border-radius:999px;text-decoration:none;font-size:14px;color:var(--sub)}
footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);color:var(--sub);font-size:13px;line-height:2}
footer a{color:var(--sub);margin-right:14px;text-decoration:none}
ul.songs li[hidden],.guide-list li[hidden]{display:none}
.pager{display:flex;justify-content:center;align-items:center;gap:4px;margin:12px 0 4px;font-size:13px}
.pager button{min-width:32px;height:32px;padding:0 6px;border:0;border-radius:999px;background:none;color:var(--sub);font:inherit;cursor:pointer}
.pager button:hover{color:var(--text)}
.pager button[aria-current]{background:var(--text);color:var(--bg);font-weight:600}
.pager button:disabled{opacity:.3;cursor:default}
.pager span{width:24px;text-align:center;color:var(--sub)}
#ck{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);width:calc(100% - 32px);max-width:440px;display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 6px 6px 16px;font-size:12px;color:var(--sub)}
#ck span{flex:1}#ck a{color:var(--sub)}
#ck button{border:0;border-radius:999px;background:var(--text);color:var(--bg);font:600 12px inherit;padding:6px 14px;cursor:pointer}
</style>
</head>
<body>
<div class="wrap">
<header>
<a class="logo" href="/"><svg viewBox="0 0 48 24" aria-hidden="true"><path d="M2 14 C7 14 8 5 13 5 S20 19 26 19 S33 8 38 8 S44 13 46 13" fill="none" stroke="#f0f0f0" stroke-width="2.6" stroke-linecap="round"/></svg>lemody</a>
<nav><a href="/songs">Songs</a><a href="/guides">Guides</a><a href="/">Open the app</a></nav>
</header>
<main>
<h1>${h1}</h1>
${body}
</main>
<footer>${FOOTER.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('')}<br>© ${new Date().getFullYear()} Lemody · made by <a href="https://wiecodes.com/about">Wiecodes</a></footer>
</div>
<div id="ck" hidden><span>Lemody uses cookies for sign-in and ads. <a href="/privacy">Privacy</a></span><button type="button">OK</button></div>
<script>
/* long lists: 20 at a time (every link stays in the page for search engines) */
(function(){var N=20;document.querySelectorAll('ul.songs,ul.guide-list').forEach(function(ul){var li=[].slice.call(ul.children);if(li.length<=N)return;var pages=Math.ceil(li.length/N),at=0,nav=document.createElement('nav');nav.className='pager';nav.setAttribute('aria-label','pages');ul.after(nav);
function list(){var keep=[0,pages-1,at-2,at-1,at,at+1,at+2].filter(function(p,i,a){return p>=0&&p<pages&&a.indexOf(p)===i}).sort(function(a,b){return a-b}),out=[];keep.forEach(function(p,i){if(i&&p-keep[i-1]>1)out.push(-1);out.push(p)});return out}
function btn(label,p,cur,dis,aria){var b=document.createElement('button');b.type='button';b.textContent=label;if(aria)b.setAttribute('aria-label',aria);if(cur)b.setAttribute('aria-current','page');b.disabled=!!dis;b.onclick=function(){go(p,true)};return b}
function go(p,scroll){at=p;li.forEach(function(l,i){l.hidden=i<at*N||i>=(at+1)*N});nav.textContent='';nav.append(btn('‹',at-1,0,at===0,'previous page'));list().forEach(function(q){if(q<0){var s=document.createElement('span');s.textContent='…';nav.append(s)}else nav.append(btn(String(q+1),q,q===at))});nav.append(btn('›',at+1,0,at===pages-1,'next page'));if(scroll&&ul.getBoundingClientRect().top<0)ul.scrollIntoView({block:'start'})}
go(0)})})();
</script>
<script>try{var k='lemo.cookieNote',c=document.getElementById('ck');if(!localStorage.getItem(k)){c.hidden=false;c.querySelector('button').onclick=function(){localStorage.setItem(k,'1');c.hidden=true}}}catch(e){}</script>
</body>
</html>
`
}

function write(path, html) {
  const file = join(dist, `${path}.html`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
}

/** sitemap entries: [path, changefreq, priority, lastmod?] */
const map = [['/', 'weekly', '1.0']]

// ---- the reading pages
for (const a of ARTICLES) {
  const ld = [{ '@type': a.kind === 'guide' ? 'Article' : 'WebPage', name: a.title, headline: a.title, description: a.description, url: `${SITE}${a.path}`, inLanguage: 'en', publisher: ORG, ...(a.kind === 'guide' ? { author: ORG, datePublished: UPDATED_ISO, dateModified: UPDATED_ISO, image: `${SITE}/og-image.jpg` } : {}) }]
  if (a.kind === 'guide') ld.push(crumbs(['Guides', '/guides'], [a.title, a.path]))
  if (a.faq) ld.push(faqLd(a.faq))
  write(a.path.slice(1), page({
    path: a.path,
    title: a.seoTitle,
    description: a.description,
    h1: esc(a.title),
    body: `${a.dated ? `<p class="updated">Last updated ${UPDATED}</p>` : ''}${a.html}`,
    jsonld: ld,
    type: a.kind === 'guide' ? 'article' : 'website',
  }))
  const [freq, pri] = a.kind === 'landing' ? ['monthly', '0.9'] : a.kind === 'guide' ? ['monthly', '0.7'] : a.path === '/guides' ? ['monthly', '0.7'] : a.dated || a.path === '/contact' ? ['yearly', '0.3'] : ['monthly', '0.5']
  map.push([a.path, freq, pri, UPDATED_ISO])
}

// ---- the songs: every one in the library (found on YouTube), once
const songs = []
if (existsSync(queue)) {
  const used = new Set()
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
} else {
  console.log('seo-pages: no analyzer/featured.json here, song pages skipped')
}

const artists = new Map()
for (const s of songs)
  for (const name of s.people) {
    const slug = slugify(name)
    if (!slug) continue
    if (!artists.has(slug)) artists.set(slug, { slug, name, songs: [] })
    artists.get(slug).songs.push(s)
  }

const byLang = new Map()
for (const s of songs) {
  const k = s.lang ?? 'Other'
  if (!byLang.has(k)) byLang.set(k, [])
  byLang.get(k).push(s)
}
/** languages with a page of their own (/karaoke/hindi …) */
const langPage = (lang) => (lang && KARAOKE_LANGS[lang] && byLang.get(lang)?.length ? `/karaoke/${KARAOKE_LANGS[lang].slug}` : null)

const artistLinks = (s) =>
  s.people.map((n) => (slugify(n) ? `<a href="/artists/${slugify(n)}">${esc(n)}</a>` : esc(n))).join(', ')
const songLink = (s) => `<li><a href="/sing/${s.slug}">${esc(s.title)}</a><span>${esc(s.artist)}</span></li>`

const FEATURES = `<ul>
<li>Your voice drawn live on the original singer's melody, so you see where you go sharp or flat</li>
<li>Synced lyrics that scroll with the song</li>
<li>Honest scores for pitch, timing and expression after every take</li>
<li>Change the key or slow the song down to practise the hard lines</li>
<li>Free, in your browser: no app to install, no sign-up</li>
</ul>`

// ---- one page per song
for (const s of songs) {
  const same = artists.get(slugify(s.people[0] ?? ''))?.songs.filter((x) => x !== s).slice(0, 12) ?? []
  const more = songs.filter((x) => x !== s && x.lang === s.lang && !same.includes(x))
  const start = (songs.indexOf(s) * 7) % Math.max(1, more.length)
  const also = [...more.slice(start), ...more.slice(0, start)].slice(0, 12)
  const lang = s.lang ? `${s.lang} ` : ''
  const lp = langPage(s.lang)
  const vids = shortsOf(s.id)
  write(`sing/${s.slug}`, page({
    path: `/sing/${s.slug}`,
    title: `${s.title} karaoke with lyrics${s.people[0] ? ` · ${s.people[0]}` : ''} | Lemody`,
    description: `Sing ${s.title}${s.artist ? ` (${s.artist})` : ''} karaoke online with synced lyrics and see your pitch live on the original melody. Free ${lang}singing practice with honest scores.`,
    h1: `Sing ${esc(s.title)}`,
    body: `<p class="by">${s.people.length ? `by ${artistLinks(s)}` : ''}${s.lang ? ` · ${lp ? `<a href="${lp}">${esc(s.lang)} song</a>` : `${esc(s.lang)} song`}` : ''}</p>
<a class="cta" href="/?song=${encodeURIComponent(s.id)}">Sing it now · free</a>
<p class="note">Opens Lemody in your browser. Use headphones for the best result.</p>
<h2>${esc(s.title)} karaoke with lyrics and live pitch</h2>
<p>Lemody plays ${esc(s.title)}${s.artist ? ` by ${esc(s.artist)}` : ''} with the vocals turned down, shows the lyrics as they come, and draws the original singer's melody on a moving graph. When you sing, your own line appears on top of it, so you can see where your pitch matches and where it drifts. After each take you get a score for pitch, timing and expression.</p>
${FEATURES}
<p class="note">New here? Read <a href="/guides/how-to-read-the-pitch-graph">how to read the pitch graph</a>.</p>
${vids.length ? `<h2>Watch: ${esc(s.title)} pitch graph on Lemody</h2>
<p>The white line is the original singer's voice, note by note. Try to stay on it when you sing.</p>
<div class="short"><iframe src="https://www.youtube-nocookie.com/embed/${vids[0].short}" title="${esc(s.title)} karaoke pitch graph · Lemody" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<p class="note"><a href="https://www.youtube.com/shorts/${vids[0].short}" rel="noopener">Watch on YouTube</a> · more on <a href="https://www.youtube.com/@lemodysounds.online" rel="noopener">Lemody's channel</a></p>` : ''}
${same.length ? `<h2>More songs by ${esc(s.people[0])}</h2><ul class="songs">${same.map(songLink).join('')}</ul>` : ''}
${also.length ? `<h2>More ${esc(s.lang ?? '')} songs to sing</h2><ul class="songs">${also.map(songLink).join('')}</ul>` : ''}`,
    jsonld: [
      { '@type': 'MusicRecording', name: s.title, url: `${SITE}/sing/${s.slug}`, inLanguage: s.lang ?? undefined,
        byArtist: s.people.map((n) => ({ '@type': 'MusicGroup', name: n })) },
      crumbs(['Songs', '/songs'], ...(lp ? [[`${s.lang} karaoke`, lp]] : []), [s.title, `/sing/${s.slug}`]),
      ...vids.slice(0, 1).map((v) => ({
        '@type': 'VideoObject',
        name: `${s.title} karaoke pitch graph${s.people[0] ? ` · ${s.people[0]}` : ''} | Lemody`,
        description: `The melody of ${s.title}${s.artist ? ` by ${s.artist}` : ''} drawn as a live pitch graph with synced lyrics. Sing it yourself free on Lemody.`,
        thumbnailUrl: `https://i.ytimg.com/vi/${v.short}/hqdefault.jpg`,
        uploadDate: `${v.date}T12:00:00+05:30`,
        contentUrl: `https://www.youtube.com/shorts/${v.short}`,
        embedUrl: `https://www.youtube.com/embed/${v.short}`,
        publisher: ORG,
      })),
    ],
  }))
  map.push([`/sing/${s.slug}`, 'monthly', '0.8'])
}

// ---- one page per artist
for (const a of artists.values()) {
  write(`artists/${a.slug}`, page({
    path: `/artists/${a.slug}`,
    title: `${a.name} karaoke songs with lyrics · sing online | Lemody`,
    description: `Sing ${a.songs.length} ${a.name} song${a.songs.length > 1 ? 's' : ''} online: ${a.songs.slice(0, 4).map((s) => s.title).join(', ')}${a.songs.length > 4 ? ' and more' : ''}. Free karaoke with synced lyrics and your pitch live on the melody.`,
    h1: `Sing ${esc(a.name)} songs`,
    body: `<p class="by">${a.songs.length} song${a.songs.length > 1 ? 's' : ''} on Lemody</p>
<p>Pick a ${esc(a.name)} song and sing along: the lyrics scroll with the music and your voice is drawn live on the original melody, so you can hear and see how close you are.</p>
<ul class="songs">${a.songs.map(songLink).join('')}</ul>`,
    jsonld: [{ '@type': 'MusicGroup', name: a.name, url: `${SITE}/artists/${a.slug}` }, crumbs(['Songs', '/songs'], [a.name, `/artists/${a.slug}`])],
  }))
  map.push([`/artists/${a.slug}`, 'weekly', '0.6'])
}

// ---- one page per language (Hindi karaoke, Punjabi karaoke …)
for (const [lang, { slug, intro }] of Object.entries(KARAOKE_LANGS)) {
  const list = byLang.get(lang)
  if (!list?.length) continue
  const path = `/karaoke/${slug}`
  const top = [...new Map(list.flatMap((s) => s.people).map((n) => [slugify(n), n])).entries()]
    .map(([sl, n]) => ({ sl, n, c: artists.get(sl)?.songs.filter((x) => x.lang === lang).length ?? 0 }))
    .filter((x) => x.sl).sort((a, b) => b.c - a.c).slice(0, 16)
  write(path.slice(1), page({
    path,
    title: `${lang} karaoke songs with lyrics · sing online free | Lemody`,
    description: `Sing ${list.length} ${lang} karaoke songs online with synced lyrics. See your pitch live on the original melody and get a score. Free, no sign-up.`,
    h1: `${lang} karaoke songs with lyrics`,
    body: `<p class="lead">${esc(intro)} Sing in your browser and see your pitch on the original melody.</p>
<a class="cta" href="/">Open Lemody</a>
<p class="note">${list.length} songs · free · no sign-up. Don't see yours? Paste its YouTube link in Lemody to add it.</p>
${top.length ? `<h2>Popular ${esc(lang)} singers</h2><p class="tags">${top.map((x) => `<a href="/artists/${x.sl}">${esc(x.n)}</a>`).join('')}</p>` : ''}
<h2>All ${esc(lang)} songs</h2>
<ul class="songs">${list.map(songLink).join('')}</ul>
<h2>Sing better</h2>
<p>Read our <a href="/guides/karaoke-tips">karaoke tips</a> or <a href="/guides/how-to-improve-your-singing-voice">how to improve your singing voice</a>.</p>`,
    jsonld: [
      { '@type': 'CollectionPage', name: `${lang} karaoke songs`, url: `${SITE}${path}`, inLanguage: 'en' },
      crumbs(['Songs', '/songs'], [`${lang} karaoke`, path]),
    ],
  }))
  map.push([path, 'weekly', '0.9'])
}

// ---- every song, by language
if (songs.length) {
  const order = [...byLang.keys()].sort((a, b) => byLang.get(b).length - byLang.get(a).length)
  const topArtists = [...artists.values()].sort((a, b) => b.songs.length - a.songs.length).slice(0, 40)
  const langLinks = order.map((k) => langPage(k)).filter(Boolean)
  write('songs', page({
    path: '/songs',
    title: `${songs.length}+ karaoke songs with lyrics · Hindi, Punjabi, English | Lemody`,
    description: `Sing ${songs.length}+ songs with synced lyrics and see your pitch live on the melody: Bollywood, Punjabi, Garhwali, Haryanvi and English hits. Free online karaoke and singing practice.`,
    h1: 'Songs you can sing on Lemody',
    body: `<p class="by">${songs.length} songs · new ones added every week</p>
<a class="cta" href="/">Open Lemody</a>
${langLinks.length ? `<h2>By language</h2><p class="tags">${order.filter((k) => langPage(k)).map((k) => `<a href="${langPage(k)}">${esc(k)} karaoke</a>`).join('')}</p>` : ''}
<h2>Popular artists</h2>
<p class="tags">${topArtists.map((a) => `<a href="/artists/${a.slug}">${esc(a.name)}</a>`).join('')}</p>
${order.map((k) => `<h2 id="${slugify(k)}">${esc(k)} songs</h2><ul class="songs">${byLang.get(k).map(songLink).join('')}</ul>`).join('\n')}`,
    jsonld: [{ '@type': 'CollectionPage', name: 'Songs on Lemody', url: `${SITE}/songs` }],
  }))
  map.splice(1, 0, ['/songs', 'weekly', '0.9'])
}

// ---- the sitemap
const today = new Date().toISOString().slice(0, 10)
writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${map.map(([p, freq, pri, mod]) => `  <url><loc>${SITE}${p}</loc><lastmod>${mod ?? today}</lastmod><changefreq>${freq}</changefreq><priority>${pri}</priority></url>`).join('\n')}
</urlset>
`)

console.log(`seo-pages: ${ARTICLES.length} reading pages, ${songs.length} songs, ${artists.size} artists, ${map.length} urls in the sitemap`)
