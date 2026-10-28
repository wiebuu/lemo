import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Wordmark } from '../components/Brand'

import { SiteFooter } from './Footer'
import { StatsPage, TopPage } from './Board'
import { go, navigate } from './router'

export const PAGES: Record<string, { title: string; body: () => ReactNode; /** smaller text and spacing on phones (lists and numbers, not reading) */ compact?: boolean }> = {
  '/top': { title: 'Today’s top', body: TopPage, compact: true },
  '/stats': { title: 'Stats', body: StatsPage, compact: true },
  '/about': { title: 'About Lemody', body: About },
  '/help': { title: 'Help & questions', body: Help },
  '/privacy': { title: 'Privacy policy', body: Privacy },
  '/terms': { title: 'Terms of use', body: Terms },
  '/contact': { title: 'Contact', body: Contact },
}


const UPDATED = '29 October 2026'

/** A site page, over the app (which keeps running underneath). Unknown addresses get a friendly 404. */
export function SitePage({ path }: { path: string }) {
  const page = PAGES[path]
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
    document.title = page ? `${page.title} · Lemody` : 'Page not found · Lemody'
    return () => {
      document.title = 'Lemody · Sing along to any song and see your pitch live'
    }
  }, [path, page])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && navigate('/')
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


const A = ({ href, children }: { href: string; children: ReactNode }) =>
  href.startsWith('/') ? <a href={href} onClick={go}>{children}</a> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>

function Updated() {
  return <p className="updated">Last updated {UPDATED}</p>
}

function About() {
  return (
    <>
      <p className="lead">Lemody is a free place to practise singing along to the songs you love — and to see, note by note, how close you are.</p>
      <h2>How it works</h2>
      <ol>
        <li><b>Pick a song.</b> Search the songs already in Lemody, or paste a YouTube link to add a new one. A new song is analysed once — the voice is separated from the music and its melody is drawn — and from then on it opens instantly for everyone.</li>
        <li><b>Sing along.</b> Put on headphones and turn on the mic. The original melody scrolls past as a line; your voice is drawn on top of it as you sing, in real time.</li>
        <li><b>See how it went.</b> After a test you get separate scores for melody shape, rhythm, stability, tone and dynamics, and you can replay any phrase to hear yourself against the original.</li>
      </ol>
      <h2>Practice tools</h2>
      <ul>
        <li>Change the key or slow the song down without changing its pitch.</li>
        <li>Loop a single phrase until it sits right.</li>
        <li>Synced lyrics in English, Hindi, Hinglish or Urdu script.</li>
        <li>A live coach that tells you when the mic can't hear you, the room is noisy, or you're too loud.</li>
        <li>Sing in any key or octave: by default only the shape of the melody counts.</li>
      </ul>
      <h2>Who makes it</h2>
      <p>Lemody is a <A href="https://wiecodes.com">Wiecodes</A> product. Questions or ideas are welcome on the <A href="/contact">contact page</A>.</p>
    </>
  )
}

function Help() {
  const qa: [string, ReactNode][] = [
    ['Do I need headphones?', 'Yes, please. Without them the song plays out of the speaker and back into the mic, and Lemody can end up hearing the singer on the recording instead of you. Wired headphones are best; Bluetooth works too after a quick latency calibration (Settings → sound → calibrate).'],
    ['The mic doesn’t work.', 'Allow microphone access when your browser asks. If you said no earlier, tap the lock or site-settings icon next to the address and allow the microphone, then reload. On iPhone, also check Settings → Safari → Microphone.'],
    ['It says there’s background noise.', 'A fan, traffic, a TV or people talking get picked up along with your voice and can pull your score down. A quieter room, or holding the phone closer to your mouth, fixes it.'],
    ['Why does a new song take a few minutes?', 'The first time a song is added, Lemody separates the voice from the music and works out the melody note by note — about one and a half times the song’s length. It only happens once: after that the song opens instantly for everyone, and pasting the same link again just opens it.'],
    ['What is “analyse on this device”?', 'Instead of waiting for Lemody’s server, your phone or computer can analyse a new song itself, using the same models as the server, so you get no queue. The first time, it downloads the analyser (about 263 MB, kept by your browser for next time). Keep Lemody open and the screen on until it’s done. The result is checked by Lemody before it’s saved, and then the song is ready for everyone. If your device is too slow, or something goes wrong, you can switch to the server at any time.'],
    ['Does Lemody store songs on my phone?', 'No. Songs live on Lemody’s servers and stream to you when you open one, so they take no space on your phone. Your song list, settings and scores are kept in your account and follow you to any device you sign in on.'],
    ['Can I hear a song before opening it?', 'Yes — press ▶ next to any search result to hear 10 seconds of it.'],
    ['Do I have to sing in the original key?', 'No. In the default “melody shape” mode you can sing in any key or octave; only the shape of the melody counts. Switch to “+ exact notes” in Settings → scoring if you want the original notes checked too.'],
    ['What do the scores mean?', 'Melody shape: how closely you follow the tune. Rhythm: whether notes start and end on time. Stability: how steadily you hold notes. Tone and dynamics: how your loudness and expression follow the original. They’re a practice guide, not a verdict on your voice.'],
    ['My voice line is a little behind the music.', 'That’s latency — common with Bluetooth. Run Settings → sound → calibrate once and it lines up.'],
    ['The lyrics are wrong or out of time.', 'Open the lyrics editor (the pencil icon) to search other sources, edit lines, or fix the timing. Your edits are saved to your account.'],
    ['Which browsers work?', 'Recent Chrome, Edge, Safari and Firefox, on phones and computers.'],
  ]
  return (
    <>
      <p className="lead">Quick answers to the things people ask most.</p>
      <div className="faq">
        {qa.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
      <p>Still stuck? <A href="/contact">Get in touch</A>.</p>
    </>
  )
}

function Privacy() {
  return (
    <>
      <Updated />
      <p className="lead">Short version: your singing is scored on your device. Your voice is uploaded only if a take makes today's top 100 — and you can turn that off. Otherwise we keep only what's needed to give you your account — your song list, settings and scores.</p>
      <h2>Your voice</h2>
      <p>Your microphone is processed entirely in your browser to draw your pitch and work out your scores. Your last take is kept in your device's memory so you can listen back; it's gone when you close the page.</p>
      <h2>Today's top</h2>
      <p>If a take scores among the best 100 of the day (at least a minute of a library song), it is shared on <A href="/top">today's top</A>: your Google name and photo, the song, your result and the recording of that take are stored on our server so other signed-in singers can open it and listen. Only your best take of the day is kept. A take is deleted as soon as it drops out of the 100, and every take is deleted when the day ends (midnight, India time). To never share, choose Settings → scoring → today's top → don't share.</p>
      <h2>Your account</h2>
      <p>You sign in with Google (through Firebase Authentication). We receive your name, email address, profile picture and a Google account ID. We use them only to sign you in and to show who's signed in.</p>
      <h2>What we store</h2>
      <ul>
        <li>Your settings (theme, scoring options and so on).</li>
        <li>Your song list, your lyric edits and breath marks, and your scores for each song.</li>
      </ul>
      <p>This is kept in Lemody's database so it follows you across devices. Your browser keeps a small copy of your settings so the app works smoothly.</p>
      <h2>Songs</h2>
      <p>When you add a song by YouTube link, it is analysed once (by our server, or by your own device if you choose) and the result is stored, so it can open instantly for everyone. When your device does the analysis, it uploads only the separated music and vocals of that song and its melody; nothing about you or your voice. Other people can find that song in search, but they can't see who added it. If you upload an audio file, it's analysed and stored on our server for you; uploads never appear in anyone else's search, and removing the song from your list deletes the file.</p>
      <h2>Other services</h2>
      <ul>
        <li><b>Google / Firebase</b> — sign-in.</li>
        <li><b>YouTube</b> — the audio of songs added by link.</li>
        <li><b>Lyrics sources</b> (LRCLIB, NetEase, lyrics.ovh, YouTube captions) — receive a song's title, singer and length when lyrics are looked up. Nothing about you is sent.</li>
      </ul>
      <p>Lemody has no ads and no advertising or tracking cookies, and we don't sell or share your data.</p>
      <h2>Deleting your data</h2>
      <p>You can remove songs from your list at any time. To delete your account and everything stored with it, contact us through the <A href="/contact">contact page</A> and we'll remove it.</p>
      <h2>Changes</h2>
      <p>If this policy changes, the date at the top changes with it.</p>
    </>
  )
}

function Terms() {
  return (
    <>
      <Updated />
      <p className="lead">Lemody is a free tool for practising singing. By using it, you agree to these terms.</p>
      <h2>Using Lemody</h2>
      <p>Lemody is for personal, non-commercial singing practice. Please don't misuse it — for example by trying to break it, overload it, or get at other people's data.</p>
      <h2>Songs and lyrics</h2>
      <p>Songs and lyrics belong to their artists and rights holders. Lemody analyses songs so you can practise along to them; it does not give you any rights to the music. Only add songs you're allowed to use, and only upload files you have the right to upload. We may remove any song, for example when a rights holder asks.</p>
      <h2>Scores</h2>
      <p>Scores are an automatic practice guide. They can be wrong, and they are not a judgement of your voice or ability.</p>
      <h2>Availability</h2>
      <p>We work to keep Lemody running well, but it is provided “as is”, without warranties. Features may change, songs may be limited by storage, and the service may sometimes be unavailable. To the extent the law allows, we aren't liable for losses from using Lemody.</p>
      <h2>Your account</h2>
      <p>You sign in with Google and are responsible for your account. You can stop using Lemody at any time and ask us to delete your data (see the <A href="/privacy">privacy policy</A>).</p>
      <h2>Changes</h2>
      <p>We may update these terms; the date at the top shows when. Using Lemody after a change means you accept the new terms.</p>
      <h2>Contact</h2>
      <p>Lemody is made by <A href="https://wiecodes.com">Wiecodes</A>. Questions: see the <A href="/contact">contact page</A>.</p>
    </>
  )
}

function Contact() {
  return (
    <>
      <p className="lead">Found a bug, have an idea, or want your data deleted? We'd love to hear from you.</p>
      <div className="card">
        <div className="card-title">Wiecodes</div>
        <p>Lemody is built and run by Wiecodes. Reach us through the website:</p>
        <a className="button" href="https://wiecodes.com" target="_blank" rel="noopener noreferrer">wiecodes.com</a>
      </div>
      <h2>Helpful to include</h2>
      <ul>
        <li>The song you were singing (its name or YouTube link).</li>
        <li>Your phone or computer and browser.</li>
        <li>What you expected, and what happened instead.</li>
      </ul>
      <p>Many common questions are answered on the <A href="/help">help page</A>.</p>
    </>
  )
}
