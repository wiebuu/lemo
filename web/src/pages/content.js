// The site's reading pages (about, guides, policies, landing pages), written once as plain
// HTML. The app shows them over itself (Pages.tsx), and the build writes each one as a
// static page too (scripts/seo-pages.mjs), so search engines and ad reviewers can read
// them without running the app. Plain JS so both can import it.

export const SITE = 'https://www.lemodysounds.online'
export const EMAIL = 'wiecodes@gmail.com'
export const UPDATED = '10 November 2026'
export const UPDATED_ISO = '2026-11-10'

const mail = `<a href="mailto:${EMAIL}">${EMAIL}</a>`

/**
 * @typedef {{ path: string, title: string, seoTitle: string, description: string,
 *   kind: 'site' | 'guide' | 'landing', html: string, dated?: boolean, faq?: [string, string][] }} Article
 */

/** @type {[string, string][]} */
const HELP_FAQ = [
  ['Do I need to sign up?', 'No. Anyone can search a song and sing. Sign in with Google only if you want your songs, settings and scores saved to your account.'],
  ['Do I need headphones?', 'Yes, please. Without them the song plays out of the speaker and back into the mic, and Lemody can end up hearing the singer on the recording instead of you. Wired headphones are best. Bluetooth works too after a quick latency calibration (Settings → sound → calibrate).'],
  ['The mic doesn’t work.', 'Allow microphone access when your browser asks. If you said no earlier, tap the lock or site-settings icon next to the address, allow the microphone, then reload. On iPhone, also check Settings → Safari → Microphone.'],
  ['It says there’s background noise.', 'A fan, traffic, a TV or people talking get picked up along with your voice and can pull your score down. A quieter room, or holding the phone closer to your mouth, fixes it.'],
  ['Why does a new song take a few minutes?', 'The first time a song is added, Lemody separates the voice from the music and works out the melody note by note. It takes about one and a half times the song’s length, and only happens once: after that the song opens instantly for everyone.'],
  ['What is “analyse on this device”?', 'Instead of waiting for Lemody’s server, your phone or computer can analyse a new song itself, with the same models. The first time, it downloads the analyser (about 263 MB, kept by your browser for next time). Keep Lemody open and the screen on until it’s done.'],
  ['Does Lemody store songs on my phone?', 'No. Songs stream from Lemody’s servers when you open one. Your song list, settings and scores are kept in your account and follow you to any device you sign in on.'],
  ['Can I hear a song before opening it?', 'Yes. Press ▶ next to any search result to hear 10 seconds of it.'],
  ['Do I have to sing in the original key?', 'No. In the default “melody shape” mode you can sing in any key or octave; only the shape of the melody counts. Switch to “+ exact notes” in Settings → scoring to have the original notes checked too.'],
  ['What do the scores mean?', 'Melody shape: how closely you follow the tune. Rhythm: whether notes start and end on time. Stability: how steadily you hold notes. Tone and dynamics: how your loudness and expression follow the original. They’re a practice guide, not a verdict on your voice.'],
  ['My voice line is a little behind the music.', 'That’s latency, common with Bluetooth. Run Settings → sound → calibrate once and it lines up.'],
  ['The lyrics are wrong or out of time.', 'Open the lyrics editor (the pencil icon) to search other sources, edit lines, or fix the timing. Your edits are saved to your account.'],
  ['Which browsers work?', 'Recent Chrome, Edge, Safari and Firefox, on phones and computers.'],
]

const faqHtml = (faq) =>
  `<div class="faq">${faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>`

const tryIt = (label = 'Start singing') => `<p><a class="button" href="/">${label}</a></p>`

/** @type {Article[]} */
export const ARTICLES = [
  // ---------------------------------------------------------------- site pages
  {
    path: '/about',
    kind: 'site',
    title: 'About Lemody',
    seoTitle: 'About Lemody · free online karaoke and singing practice',
    description: 'Lemody is a free singing practice app by Wiecodes: sing along with lyrics, see your pitch live on the original melody and get honest scores.',
    html: `
<p class="lead">Lemody is a free place to practise singing along to the songs you love, and to see, note by note, how close you are.</p>
<h2>How it works</h2>
<ol>
<li><b>Pick a song.</b> Search the songs already in Lemody, or paste a YouTube link to add a new one. A new song is analysed once: the voice is separated from the music and its melody is drawn. From then on it opens instantly for everyone.</li>
<li><b>Sing along.</b> Put on headphones and turn on the mic. The original melody scrolls past as a line, and your voice is drawn on top of it as you sing.</li>
<li><b>See how it went.</b> After a test you get separate scores for melody shape, rhythm, stability, tone and dynamics. You can replay any phrase to hear yourself against the original.</li>
</ol>
<h2>Practice tools</h2>
<ul>
<li>Change the key or slow the song down without changing its pitch.</li>
<li>Loop a single phrase until it sits right.</li>
<li>Synced lyrics in English, Hindi, Hinglish or Urdu script.</li>
<li>A live coach that tells you when the mic can’t hear you, the room is noisy, or you’re too loud.</li>
<li>Sing in any key or octave: by default only the shape of the melody counts.</li>
</ul>
<h2>Songs in many languages</h2>
<p>Hindi and Bollywood, Punjabi, English, Haryanvi, Garhwali and more. See <a href="/songs">all songs</a>, or ask for one that’s missing on <a href="/coming">coming soon</a>.</p>
<h2>Learn as you go</h2>
<p>Short <a href="/guides">guides</a> explain how to read the pitch graph, build a daily practice routine and improve your singing voice.</p>
<h2>Who makes it</h2>
<p>Lemody is made by <a href="https://wiecodes.com">Wiecodes</a>, a small independent studio. Write to us any time at ${mail}.</p>`,
  },
  {
    path: '/help',
    kind: 'site',
    title: 'Help & questions',
    seoTitle: 'Help · Lemody singing app questions',
    description: 'Answers to common Lemody questions: headphones, microphone access, background noise, scores, latency, lyrics and supported browsers.',
    faq: HELP_FAQ,
    html: `
<p class="lead">Quick answers to the things people ask most.</p>
${faqHtml(HELP_FAQ)}
<p>New to Lemody? Start with <a href="/guides/how-to-read-the-pitch-graph">how to read the pitch graph</a>. Still stuck? <a href="/contact">Get in touch</a>.</p>`,
  },
  {
    path: '/privacy',
    kind: 'site',
    dated: true,
    title: 'Privacy policy',
    seoTitle: 'Privacy policy · Lemody',
    description: 'How Lemody handles your data: your voice stays on your device, Google sign-in, cookies, Google AdSense ads, and your rights to access and delete your data.',
    html: `
<p class="lead">Short version: your singing is scored on your device. We keep only what’s needed to run your account. We show ads from Google, which use cookies. You can ask us to delete your data at any time.</p>
<p>Lemody (lemodysounds.online) is run by Wiecodes. Contact: ${mail}.</p>

<h2>Your voice</h2>
<p>Your microphone is processed in your browser to draw your pitch and work out your scores. Your last take stays in your device’s memory so you can listen back. It’s gone when you close the page. Your voice is uploaded only if a take makes today’s top 100 and you choose to share it (see below).</p>

<h2>Your account</h2>
<p>You can use Lemody without an account. If you sign in with Google (through Firebase Authentication, a Google service), we receive your name, email address, profile picture and a Google account ID. We use them to sign you in and show who’s signed in.</p>

<h2>What we store</h2>
<ul>
<li>Your settings (theme, scoring options and so on).</li>
<li>Your song list, liked songs, lyric edits, breath marks and scores.</li>
</ul>
<p>This is kept in our database (Google Firebase) so it follows you across devices. Your browser keeps a small copy of your settings so the app works smoothly.</p>

<h2>Songs you ask for</h2>
<p>When you ask Lemody to add a song, it’s listed on <a href="/coming">coming soon</a> for signed-in singers: the song, its link, when it was asked for, and the first name of everyone who asked. If someone adds it by analysing it on their own device, their first name is shown with it. Cancel a request and your name comes off the list.</p>

<h2>Today’s top</h2>
<p>If a take scores among the best 100 of the day, it is shown on <a href="/top">today’s top</a> with your Google name and photo, the song, your result and your pitch line. You’re asked whether others may also hear your voice; only if you say yes is that recording stored. Takes are deleted when they drop out of the 100, and all takes are deleted at the end of the day (midnight, India time). To stay off the board, choose Settings → scoring → today’s top → don’t share.</p>

<h2>Songs</h2>
<p>A song added by YouTube link is analysed once and the result is stored, so it opens instantly for everyone. Others can find it in search but can’t see who added it. An audio file you upload is stored for you only, and deleted when you remove it from your list.</p>

<h2>Cookies and local storage</h2>
<p>Cookies are small files a website stores in your browser. Lemody uses:</p>
<ul>
<li><b>Essential storage</b> — keeps you signed in and remembers your settings. The app can’t work without it.</li>
<li><b>Advertising cookies</b> — set by Google to show and measure ads (see below).</li>
</ul>
<p>You can clear or block cookies in your browser settings. Blocking essential storage may sign you out.</p>

<h2>Advertising (Google AdSense)</h2>
<p>Lemody is free because it shows ads served by Google AdSense.</p>
<ul>
<li>Third-party vendors, including Google, use cookies to serve ads based on your earlier visits to this and other websites.</li>
<li>Google’s advertising cookies let Google and its partners serve ads to you based on your visits to Lemody and/or other sites on the internet.</li>
<li>You can turn off personalised ads in <a href="https://adssettings.google.com">Google Ads Settings</a>, or opt out of many third-party vendors’ cookies at <a href="https://www.aboutads.info/choices/">aboutads.info</a> and <a href="https://www.youronlinechoices.eu/">youronlinechoices.eu</a>.</li>
<li>Learn more in <a href="https://policies.google.com/technologies/partner-sites">how Google uses information from sites that use its services</a>.</li>
</ul>
<p>In the EEA, the UK and Switzerland, you’re asked for consent before personalised ads are shown, and you can change your choice at any time.</p>

<h2>Analytics and logs</h2>
<p>We don’t use a separate analytics or tracking service. Our hosting and servers keep standard logs (such as IP address, browser and pages requested) for a short time to keep the service secure and working.</p>

<h2>Other services</h2>
<ul>
<li><b>Google / Firebase</b> — sign-in and the database.</li>
<li><b>Google AdSense</b> — ads.</li>
<li><b>YouTube</b> — the audio of songs added by link.</li>
<li><b>Lyrics sources</b> (LRCLIB, NetEase, lyrics.ovh, YouTube captions) — receive a song’s title, singer and length when lyrics are looked up. Nothing about you.</li>
</ul>
<p>We don’t sell your personal data.</p>

<h2>Your rights</h2>
<p>You can ask to see the data we hold about you, correct it, get a copy, or have it deleted. You can withdraw consent for personalised ads at any time. Write to ${mail} and we’ll reply within 30 days. You can also complain to your local data protection authority.</p>

<h2>Children</h2>
<p>Lemody is not directed at children under 13, and we don’t knowingly collect their data. If you think a child has given us data, contact us and we’ll delete it.</p>

<h2>Changes</h2>
<p>If this policy changes, the date at the top changes with it.</p>`,
  },
  {
    path: '/terms',
    kind: 'site',
    dated: true,
    title: 'Terms of use',
    seoTitle: 'Terms of use · Lemody',
    description: 'The terms for using Lemody, the free online karaoke and singing practice app made by Wiecodes.',
    html: `
<p class="lead">Lemody is a free tool for practising singing. By using it, you agree to these terms.</p>
<h2>Using Lemody</h2>
<p>Lemody is for personal, non-commercial singing practice. Please don’t misuse it, for example by trying to break it, overload it, or get at other people’s data.</p>
<h2>Songs and lyrics</h2>
<p>Songs and lyrics belong to their artists and rights holders. Lemody analyses songs so you can practise along to them; it gives you no rights to the music. Only add songs you’re allowed to use, and only upload files you have the right to upload. We may remove any song, for example when a rights holder asks. Rights holders can write to ${mail}.</p>
<h2>What you share</h2>
<p>If you share a take on today’s top, other signed-in singers can see it (and hear it, if you allow). Don’t share anything offensive or that isn’t yours.</p>
<h2>Ads</h2>
<p>Lemody shows ads to stay free. Ads come from third parties; we aren’t responsible for what they offer.</p>
<h2>Scores</h2>
<p>Scores are an automatic practice guide. They can be wrong, and they are not a judgement of your voice or ability.</p>
<h2>Availability</h2>
<p>Lemody is provided “as is”, without warranties. Features may change and the service may sometimes be unavailable. To the extent the law allows, we aren’t liable for losses from using Lemody.</p>
<h2>Your account</h2>
<p>You’re responsible for your account. You can stop using Lemody at any time and ask us to delete your data (see the <a href="/privacy">privacy policy</a>).</p>
<h2>Changes</h2>
<p>We may update these terms; the date at the top shows when. Using Lemody after a change means you accept the new terms.</p>
<h2>Contact</h2>
<p>Lemody is made by <a href="https://wiecodes.com">Wiecodes</a>. Questions: ${mail}.</p>`,
  },
  {
    path: '/contact',
    kind: 'site',
    title: 'Contact',
    seoTitle: 'Contact Lemody',
    description: 'Contact the Lemody team at Wiecodes: bugs, ideas, song requests, rights questions or deleting your data.',
    html: `
<p class="lead">Found a bug, have an idea, or want your data deleted? We’d love to hear from you.</p>
<div class="card">
<div class="card-title">Email</div>
<p>Lemody is built and run by Wiecodes. We usually reply within two days.</p>
<a class="button" href="mailto:${EMAIL}">${EMAIL}</a>
</div>
<h2>Helpful to include</h2>
<ul>
<li>The song you were singing (its name or YouTube link).</li>
<li>Your phone or computer and browser.</li>
<li>What you expected, and what happened instead.</li>
</ul>
<h2>Rights holders</h2>
<p>If you own a song or lyrics and want them removed, email us with the song’s link and we’ll take it down.</p>
<p>Many common questions are answered on the <a href="/help">help page</a>. More about us: <a href="https://wiecodes.com">wiecodes.com</a>.</p>`,
  },

  // ---------------------------------------------------------------- landing pages
  {
    path: '/karaoke-online',
    kind: 'landing',
    title: 'Free online karaoke with lyrics',
    seoTitle: 'Free online karaoke with lyrics and scores · no sign-up | Lemody',
    description: 'Sing karaoke online for free: Hindi, Punjabi and English songs with synced lyrics, your pitch drawn live on the melody and a score after every song. No sign-up.',
    faq: [
      ['Is it really free?', 'Yes. Lemody is free and runs in your browser. Ads keep it that way.'],
      ['Do I need to download an app?', 'No. It works in Chrome, Safari, Edge and Firefox, on phones and computers.'],
      ['Can I sing Hindi and Punjabi songs?', 'Yes. Hindi and Bollywood, Punjabi, Haryanvi, Garhwali, English and more. Paste a YouTube link to add any song.'],
      ['Does it give a score?', 'Yes. After a test you get scores for melody, rhythm, stability, tone and dynamics.'],
    ],
    html: `
<p class="lead">Pick a song, put on headphones and sing. Lemody shows the lyrics, draws your voice on the original melody and scores you at the end. No sign-up, no download.</p>
${tryIt('Sing karaoke now')}
<h2>What makes it different</h2>
<ul>
<li><b>You see your pitch.</b> The singer’s melody scrolls past as a line. Your voice appears on top, so you see where you’re sharp or flat.</li>
<li><b>Synced lyrics.</b> Words light up as they’re sung, in English, Hindi, Hinglish or Urdu script.</li>
<li><b>An honest score.</b> Separate marks for melody, rhythm, stability and dynamics, not one random number.</li>
<li><b>Any key.</b> Sing higher or lower than the original. Only the shape of the melody counts.</li>
<li><b>Practice tools.</b> Slow the song down, change the key, loop one line.</li>
</ul>
<h2>Songs to sing</h2>
<p>Bollywood hits, old Hindi classics, Punjabi, Haryanvi and Garhwali songs, and English pop. Browse by language:</p>
<p class="tags"><a href="/karaoke/hindi">Hindi karaoke</a><a href="/karaoke/punjabi">Punjabi karaoke</a><a href="/karaoke/english">English karaoke</a><a href="/karaoke/haryanvi">Haryanvi karaoke</a><a href="/karaoke/garhwali">Garhwali karaoke</a><a href="/songs">All songs</a></p>
<p>Can’t find yours? Paste its YouTube link in Lemody and it’s added for everyone.</p>
<h2>How to sing karaoke online</h2>
<ol>
<li>Open Lemody and search for a song.</li>
<li>Plug in headphones so the music doesn’t leak into the mic.</li>
<li>Turn on the mic and start a test.</li>
<li>Sing, then read your score and replay the lines you missed.</li>
</ol>
<p>New to singing along? Read our <a href="/guides/karaoke-tips">karaoke tips</a>.</p>
<h2>Questions</h2>`,
  },
  {
    path: '/pitch-checker',
    kind: 'landing',
    title: 'Singing pitch checker',
    seoTitle: 'Online singing pitch checker · see if you sing in tune | Lemody',
    description: 'Check your singing pitch online for free. Sing along to a real song and see your voice on the original melody, note by note, with cents sharp or flat.',
    faq: [
      ['How does the pitch checker work?', 'Your browser listens through the mic, finds the note you’re singing many times a second, and draws it on the song’s melody. Nothing is uploaded.'],
      ['What are cents?', 'A cent is a hundredth of a semitone. Within about ±20 cents sounds in tune to most listeners.'],
      ['Can I check my pitch without a song?', 'Lemody is built around songs: it compares you with the original singer, which tells you far more than a bare note.'],
    ],
    html: `
<p class="lead">Want to know if you’re singing in tune? Sing along to a real song and Lemody draws your pitch right on the original singer’s melody.</p>
${tryIt('Check my pitch')}
<h2>What you see</h2>
<ul>
<li><b>Grey pills</b> are the notes of the melody, with the lyric above each one.</li>
<li><b>Your coloured line</b> is your voice, drawn live.</li>
<li><b>Orange</b> means you’re above the note: go lower. <b>Blue</b> means you’re below: go higher.</li>
<li>The number shows how far off you are, in cents. 100 cents is one semitone.</li>
</ul>
<p>More detail: <a href="/guides/how-to-read-the-pitch-graph">how to read the pitch graph</a>.</p>
<h2>Better than a tuner</h2>
<p>A tuner tells you one note. Singing is about moving between notes in time. Lemody checks the whole line: whether you land on each note, hold it steady, and move on time.</p>
<h2>Sing in your own key</h2>
<p>By default, Lemody moves your line into the song’s key. A low voice can sing a high song and still be checked fairly. Turn on exact notes in settings when you want the original pitch checked too.</p>
<h2>Private by design</h2>
<p>Your voice is analysed in your browser. It isn’t recorded on our servers.</p>
<h2>Questions</h2>`,
  },
  {
    path: '/singing-test',
    kind: 'landing',
    title: 'Online singing test',
    seoTitle: 'Singing test online free · test your singing voice with real songs | Lemody',
    description: 'Take a free online singing test with a real song. Get scores for melody, rhythm, stability and dynamics, and hear yourself next to the original singer.',
    faq: [
      ['How long is a test?', 'As long as you like. Sing a full song, or a part of it. Results need about 45 seconds of singing to count for today’s top.'],
      ['Is the score accurate?', 'It’s an automatic practice guide. It’s most accurate with headphones in a quiet room.'],
      ['Can I compare my scores over time?', 'Yes. Sign in and Lemody keeps your scores for every song.'],
    ],
    html: `
<p class="lead">Pick a song you know, sing it, and find out how close you are to the original. Free, in your browser.</p>
${tryIt('Take the singing test')}
<h2>Your results</h2>
<ul>
<li><b>Melody shape</b> — how closely you follow the tune.</li>
<li><b>Rhythm</b> — whether your notes start and end on time.</li>
<li><b>Stability</b> — how steadily you hold notes.</li>
<li><b>Tone and dynamics</b> — whether your loudness rises and falls like the original.</li>
</ul>
<p>Then replay any phrase: hear yourself, then the original, and see both lines on the graph.</p>
<h2>Tips for a fair result</h2>
<ul>
<li>Use headphones, so the song doesn’t leak into the mic.</li>
<li>Find a quiet room.</li>
<li>Pick a song you know well for your first test.</li>
<li>Warm up for a few minutes first. See the <a href="/guides/daily-vocal-practice-routine">daily practice routine</a>.</li>
</ul>
<h2>Make the board</h2>
<p>The best 100 takes of the day go on <a href="/top">today’s top</a>. Sing at least 45 seconds of a song to qualify.</p>
<h2>Questions</h2>`,
  },

  // ---------------------------------------------------------------- guides
  {
    path: '/guides/how-to-read-the-pitch-graph',
    kind: 'guide',
    title: 'How to read the pitch graph',
    seoTitle: 'How to read a singing pitch graph · Lemody guide',
    description: 'A simple guide to Lemody’s pitch graph: melody notes, your voice line, sharp and flat colours, cents, and the loudness lane.',
    html: `
<p class="lead">The pitch graph is the heart of Lemody. Once you can read it, you can see exactly what to fix.</p>
<h2>Time and pitch</h2>
<p>Time moves from right to left. The line in the middle is “now”. Higher on the graph means a higher note. Note names, like C4 or E4, sit on the left.</p>
<h2>The melody</h2>
<p>The grey pills are the notes of the original singer. Each one shows the syllable sung on it. A long pill is a held note. A pill that lights up is the one being sung right now.</p>
<h2>Your voice</h2>
<p>Turn on the mic and sing. Your voice appears as a coloured line. If it sits on the pills, you’re in tune.</p>
<h2>Sharp and flat</h2>
<ul>
<li><b>Orange</b>: you’re above the note (sharp). Bring it down.</li>
<li><b>Blue</b>: you’re below the note (flat). Lift it up.</li>
</ul>
<p>The small number shows how far off you are, in cents. 100 cents is one semitone. Most people hear anything within about 20 cents as in tune.</p>
<h2>Your own key</h2>
<p>You don’t have to sing in the original key. In melody-shape mode, Lemody shifts your line into the song’s key. Only the shape of the melody counts, so a low voice can sing a high song.</p>
<h2>The loudness lane</h2>
<p>The thin lane at the bottom compares your loudness with the original. It is relative to you, so your mic volume doesn’t matter. It shows whether you get louder and softer in the same places as the singer.</p>
<h2>What patterns mean</h2>
<ul>
<li><b>Line always a bit high or low:</b> you’re hearing the note but aiming off. Slow the song down and match one note at a time.</li>
<li><b>Line wobbling around the pill:</b> breath support. See <a href="/guides/how-to-improve-your-singing-voice">how to improve your singing voice</a>.</li>
<li><b>Line starting late:</b> you’re following the singer instead of the beat. Turn on the metronome (K).</li>
<li><b>Line sliding into notes:</b> common on big jumps. Loop the phrase and aim for the note’s start.</li>
</ul>
${tryIt('Try it on a song')}`,
  },
  {
    path: '/guides/how-to-improve-your-singing-voice',
    kind: 'guide',
    title: 'How to improve your singing voice',
    seoTitle: 'How to improve your singing voice at home · 8 simple steps | Lemody',
    description: 'Eight simple, practical ways to improve your singing voice at home: breathing, posture, warm-ups, pitch, recording yourself and practising little and often.',
    html: `
<p class="lead">A better singing voice comes from small habits, practised often. You don’t need a studio. You need a quiet room, a few minutes a day, and honest feedback.</p>
<h2>1. Breathe low</h2>
<p>Put a hand on your belly. Breathe in through your nose and feel it move out, not your shoulders up. Low breath gives you steady air, and steady air gives steady notes.</p>
<h2>2. Stand tall</h2>
<p>Feet apart, knees soft, chest open, chin level. A slumped body squeezes your breath. If you sit, sit at the front of the chair.</p>
<h2>3. Warm up first</h2>
<p>Five minutes is enough. Hum, do lip trills, then slide gently from low to high and back. Never start on your hardest song.</p>
<h2>4. Train your ear</h2>
<p>Singing in tune starts with hearing. Sing one note, hold it, and check it on a <a href="/pitch-checker">pitch checker</a>. Then try short phrases. The more you see your pitch, the faster your ear learns.</p>
<h2>5. Slow it down</h2>
<p>Hard line? Slow the song down without changing its key, loop just that line, and sing it five times. Then speed it back up.</p>
<h2>6. Record and listen</h2>
<p>You sound different from the inside. Listen back to your take next to the original. Notice one thing to fix, not ten.</p>
<h2>7. Look after your voice</h2>
<ul>
<li>Drink water through the day.</li>
<li>Don’t shout or whisper for long.</li>
<li>Stop if it hurts. Strain is not progress.</li>
<li>Sleep. A tired voice is a flat voice.</li>
</ul>
<h2>8. Little and often</h2>
<p>Fifteen minutes a day beats two hours on Sunday. Follow a <a href="/guides/daily-vocal-practice-routine">daily practice routine</a> and track your scores. Small gains add up fast.</p>
<h2>When to get a teacher</h2>
<p>An app shows you what happened. A good teacher shows you why. If you feel strain, keep hitting the same wall, or want to sing seriously, a few lessons are worth it.</p>
${tryIt('Start practising')}`,
  },
  {
    path: '/guides/daily-vocal-practice-routine',
    kind: 'guide',
    title: 'A 15-minute daily vocal practice routine',
    seoTitle: '15-minute daily vocal practice routine for beginners | Lemody',
    description: 'A simple 15-minute vocal practice routine for beginners: warm-ups, pitch exercises, one song section, and a short cool-down. Do it every day.',
    html: `
<p class="lead">Fifteen minutes, every day. That’s all a beginner needs to hear real progress in a month.</p>
<h2>Minutes 0–3: breathe and hum</h2>
<ul>
<li>Breathe in for 4 counts, out on a slow “sss” for 8. Repeat four times.</li>
<li>Hum a comfortable note. Feel it buzz in your lips and nose.</li>
</ul>
<h2>Minutes 3–6: wake the voice</h2>
<ul>
<li>Lip trills: blow through loose lips like a motorboat, sliding up and down.</li>
<li>Sirens on “ng” or “oo”, from your lowest easy note to your highest easy note.</li>
</ul>
<h2>Minutes 6–9: pitch</h2>
<ul>
<li>Sing five notes up and down a scale on “ma”: do-re-mi-fa-sol-fa-mi-re-do.</li>
<li>Move it up a step each time, and stop before it strains.</li>
<li>Check yourself on the <a href="/pitch-checker">pitch graph</a>: are you landing on each note?</li>
</ul>
<h2>Minutes 9–14: one song section</h2>
<p>Pick one verse or chorus, not the whole song.</p>
<ol>
<li>Listen once while reading the lyrics.</li>
<li>Loop it and sing it three times. Slow it down if needed.</li>
<li>Do one test take. Note your score.</li>
</ol>
<h2>Minutes 14–15: cool down</h2>
<p>Gentle humming, sliding downwards. Then a sip of water.</p>
<h2>Each week</h2>
<ul>
<li>Keep the same song for the whole week and watch the score climb.</li>
<li>Next week, pick a slightly harder one.</li>
<li>Once a week, try a song in a new language or style.</li>
</ul>
<p>Want to know where to start? <a href="/guides/find-your-vocal-range">Find your vocal range</a> first.</p>
${tryIt('Pick a song')}`,
  },
  {
    path: '/guides/find-your-vocal-range',
    kind: 'guide',
    title: 'How to find your vocal range',
    seoTitle: 'How to find your vocal range and the right key for you | Lemody',
    description: 'Find your vocal range in a few minutes, learn what bass, tenor, alto and soprano mean, and how to pick a song key that suits your voice.',
    html: `
<p class="lead">Your range is the span from your lowest to your highest comfortable note. Knowing it helps you pick songs, and keys, that suit you.</p>
<h2>Find it in three minutes</h2>
<ol>
<li>Warm up first with a little humming.</li>
<li>Sing “ah” on a comfortable note. Slide down slowly until the note gets weak or croaky. The last clear note is your lowest.</li>
<li>Slide up the same way until it strains or cracks. The last easy note is your highest.</li>
<li>Read both notes on a pitch graph, like Lemody’s note names on the left.</li>
</ol>
<p>Count only notes you can sing with ease. A squeezed high note doesn’t count.</p>
<h2>Common voice types</h2>
<ul>
<li><b>Bass</b>: about E2 to E4.</li>
<li><b>Baritone</b>: about A2 to A4. The most common male voice.</li>
<li><b>Tenor</b>: about C3 to C5.</li>
<li><b>Alto</b>: about F3 to F5. The most common female voice.</li>
<li><b>Mezzo-soprano</b>: about A3 to A5.</li>
<li><b>Soprano</b>: about C4 to C6.</li>
</ul>
<p>These are rough guides, not boxes. Range grows with practice.</p>
<h2>Pick the right key</h2>
<p>If a song sits too high or too low, change its key. In Lemody, move the key up or down a few steps until the chorus feels easy. Men singing songs by female singers often go down about 5 steps; women singing male songs often go up about 5.</p>
<p>In melody-shape mode, you can also just sing an octave lower or higher. Lemody scores the shape of the melody, not the exact notes.</p>
<h2>Stretch it safely</h2>
<p>Work near the edges of your range for a minute or two a day, gently. See <a href="/guides/how-to-sing-high-notes">how to sing high notes</a>.</p>
${tryIt('Find a song in your range')}`,
  },
  {
    path: '/guides/how-to-sing-high-notes',
    kind: 'guide',
    title: 'How to sing high notes without strain',
    seoTitle: 'How to sing high notes without straining · Lemody guide',
    description: 'Practical ways to sing high notes without straining: breath support, staying relaxed, vowel shapes, head voice, and practising in small steps.',
    html: `
<p class="lead">High notes don’t come from pushing harder. They come from staying relaxed while your breath does the work.</p>
<h2>Why high notes hurt</h2>
<p>Most strain comes from three things: too much air pushed too hard, a tight throat or jaw, and reaching up with your chin. Fix these and the note often just appears.</p>
<h2>1. Support with breath</h2>
<p>Breathe low before the phrase. As you go up, keep a gentle, steady flow, as if blowing out a candle slowly. Don’t blast it.</p>
<h2>2. Stay loose</h2>
<ul>
<li>Keep your jaw soft and your tongue forward.</li>
<li>Keep your chin level. Don’t reach up.</li>
<li>Check your neck and shoulders in a mirror.</li>
</ul>
<h2>3. Open the vowel</h2>
<p>Tight vowels like “ee” are hard up high. Shade them open: “ee” towards “ih”, “ay” towards “eh”. It still sounds right in the song.</p>
<h2>4. Use head voice</h2>
<p>Your head voice is the lighter sound you use for a gentle “woo” like an owl. Slide from your normal voice into it on a siren. Smoothing that change is what lets you reach high notes without shouting.</p>
<h2>5. Climb in small steps</h2>
<p>Lower the song’s key until the high line is easy. Sing it there a few times. Raise the key one step and repeat. Stop the moment it hurts.</p>
<h2>6. Check your pitch</h2>
<p>High notes often go flat when you get tired. Watch the <a href="/guides/how-to-read-the-pitch-graph">pitch graph</a>: if your line turns blue on the top note, rest, then try it softer.</p>
${tryIt('Practise a high line')}`,
  },
  {
    path: '/guides/karaoke-tips',
    kind: 'guide',
    title: 'Karaoke tips: sound better tonight',
    seoTitle: 'Karaoke tips for beginners · how to sound better singing karaoke | Lemody',
    description: 'Simple karaoke tips for beginners: picking the right song and key, using the mic, breathing, handling nerves, and practising before the night.',
    html: `
<p class="lead">Good karaoke isn’t about a perfect voice. It’s about picking the right song, knowing it well, and enjoying it.</p>
<h2>Pick the right song</h2>
<ul>
<li>Choose a song you know by heart, not one you just like.</li>
<li>Check the range: if the chorus is a struggle in the car, it will be on stage too.</li>
<li>Mid-tempo songs are easier than very fast or very slow ones.</li>
<li>Duets are a great first song. Half the pressure.</li>
</ul>
<h2>Fix the key</h2>
<p>Most karaoke apps let you change the key. Move it until the highest line feels easy. Nobody in the room will notice, but they will notice a strained note.</p>
<h2>Practise first</h2>
<p>Sing it at home a few times with the lyrics and a <a href="/pitch-checker">pitch checker</a>. Find the two or three lines where you go off and loop just those.</p>
<h2>Use the mic well</h2>
<ul>
<li>Hold it a fist’s width from your mouth, pointing at your mouth.</li>
<li>Pull it back a little on loud notes.</li>
<li>Don’t cover the top of the mic with your hand.</li>
</ul>
<h2>Breathe at the commas</h2>
<p>Plan where you’ll breathe, usually at the end of lines. Running out of air is the main reason notes go flat.</p>
<h2>Handle nerves</h2>
<p>Breathe out slowly before you start. Look at friends, not the screen. If you miss a line, smile and carry on. Energy beats accuracy at karaoke.</p>
<h2>Try it online</h2>
<p>Practise any time with <a href="/karaoke-online">free online karaoke</a>: Hindi, Punjabi and English songs with lyrics and a score.</p>
${tryIt('Sing a song now')}`,
  },
]

/** The guides, in the order shown on /guides. */
export const GUIDES = ARTICLES.filter((a) => a.kind === 'guide')

ARTICLES.push({
  path: '/guides',
  kind: 'site',
  title: 'Singing guides',
  seoTitle: 'Singing guides: practice, pitch and karaoke tips | Lemody',
  description: 'Short, practical singing guides: improve your voice at home, a daily vocal practice routine, find your vocal range, sing high notes and karaoke tips.',
  html: `
<p class="lead">Short, practical guides to help you sing better. Read one, then try it on a song.</p>
<ul class="guide-list">${GUIDES.map((g) => `<li><a href="${g.path}">${g.title}</a><span>${g.description}</span></li>`).join('')}</ul>
<h2>Tools</h2>
<ul class="guide-list">
<li><a href="/karaoke-online">Free online karaoke</a><span>Songs with lyrics, live pitch and a score.</span></li>
<li><a href="/pitch-checker">Singing pitch checker</a><span>See if you sing in tune, note by note.</span></li>
<li><a href="/singing-test">Online singing test</a><span>Score your singing against the original.</span></li>
</ul>`,
})

// landing pages end with their questions
for (const a of ARTICLES) if (a.kind === 'landing' && a.faq) a.html += faqHtml(a.faq)

/** Language pages built from the song library by the build (scripts/seo-pages.mjs). */
export const KARAOKE_LANGS = {
  Hindi: { slug: 'hindi', intro: 'Bollywood hits, old Hindi classics and new film songs, with synced lyrics in Hindi or Hinglish.' },
  Punjabi: { slug: 'punjabi', intro: 'Punjabi pop, bhangra and romantic songs, with synced lyrics.' },
  English: { slug: 'english', intro: 'English pop, rock and ballads, with synced lyrics.' },
  Haryanvi: { slug: 'haryanvi', intro: 'Popular Haryanvi songs, with synced lyrics.' },
  Garhwali: { slug: 'garhwali', intro: 'Garhwali folk and new songs from Uttarakhand, with synced lyrics.' },
}

/** Links in the site footer (static pages show all; the app shows a shorter list). */
export const FOOTER = [
  ['/songs', 'Songs'],
  ['/guides', 'Guides'],
  ['/karaoke-online', 'Karaoke online'],
  ['/pitch-checker', 'Pitch checker'],
  ['/singing-test', 'Singing test'],
  ['/about', 'About'],
  ['/help', 'Help'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/contact', 'Contact'],
]
