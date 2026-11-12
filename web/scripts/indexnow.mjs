// Tell Bing, Yandex, Seznam and Naver (IndexNow) about every page in the live sitemap.
// Run after a deploy:  node scripts/indexnow.mjs
const SITE = 'https://www.lemodysounds.online'
const KEY = 'e0355af2d3e87eb56b51801db2959db7' // public/e0355af2d3e87eb56b51801db2959db7.txt proves the site is ours
const xml = await (await fetch(`${SITE}/sitemap.xml`)).text()
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: 'www.lemodysounds.online', key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList }),
})
console.log(`indexnow: ${urlList.length} urls -> ${res.status} ${res.statusText}`)
