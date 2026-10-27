# Lemody

**sing along · see your pitch · get better** · [lemodysounds.online](https://lemodysounds.online) · a [Wiecodes](https://wiecodes.com) product

Lemody is a minimal, distraction-free singing practice studio. Play a song, see its vocal melody scroll past as a pitch graph, sing into your mic, and watch your live pitch drawn on top. You get honest feedback: on pitch, sharp or flat, cents off, octave errors, and per-phrase scores you can compare across attempts.

Your voice is analysed in the browser and never uploaded. Only your **last take** is kept, in the page's memory, so you can press **hear** and listen back with the music. It's never saved to disk, and it's replaced when you sing again or close the page.

---

> The code and settings still use the working name **lemo** (`lemo_analyzer`, `LEMO_*` settings, `lemo.*` browser storage). Those are internal and kept on purpose, so nobody's saved songs, settings or sign-in break. Everything people see says **Lemody**.

## Quick start

Requirements: **Node 20+**, **Python 3.11+**, and **ffmpeg** (`brew install ffmpeg`). Optional: **rubberband** (`brew install rubberband`) for high-quality speed/key changes.

```bash
npm install          # root helper (concurrently)
npm run setup        # web deps + Python venv for the analyzer (downloads PyTorch, ~1 GB)
npm run dev          # web on http://localhost:5173 + analyzer on :8787
```

Open http://localhost:5173 and **sign in with Google** (set up below), then pick a song or click **try the demo**.

### Sign-in (Google only)

lemo opens only after you sign in with Google. No other sign-in method works, and the analyzer refuses every request (except `/api/health`) that doesn't carry a valid Google sign-in from your Firebase project. One-time setup, free:

1. **Create the project:** in the [Firebase console](https://console.firebase.google.com), click **Add project** (the free Spark plan is enough).
2. **Turn on Google sign-in:** go to **Build → Authentication → Get started → Sign-in method**, then **Google → Enable**, pick a support email, and save. Leave every other provider off.
3. **Register the web app:** go to **Project settings → General → Your apps → Add app → Web (`</>`)** and register it. From the config it shows, copy `apiKey`, `authDomain`, `projectId` and `appId` into `web/.env.local`, starting from `web/.env.example`.
4. **Tell the analyzer:** put the same project ID in `analyzer/.env` as `LEMO_FIREBASE_PROJECT_ID=…`.
5. **Restart:** run `npm run dev` again.

`localhost` is an authorized sign-in domain by default. If you open lemo from another address, add it under **Authentication → Settings → Authorized domains**. The web settings identify your project; they aren't secrets. Security comes from Google sign-in and the analyzer verifying each user's token.

The first analysis downloads the Demucs model (~80 MB). After that, songs are cached in `analyzer/data/` and reopen instantly from the **library**.

---

## Song sources: what works and how

| Source | How | Melody comes from |
|---|---|---|
| **Featured songs** | the start page lists them (hindi / english) | analysed once on the server and kept there |
| **Demo** ("Kettle Morning") | built in, written for lemo | exact, known notes |
| **Audio file upload** | `upload & analyse` | Demucs vocal separation, then CREPE pitch tracking, then note segmentation |
| **YouTube link** | paste a link (needs `LEMO_ENABLE_YOUTUBE=true`) | same pipeline, audio fetched with yt-dlp |
| **Local audio + chart** | `open audio + chart` | your UltraStar `.txt` / `.mid` / `.kar` chart (human-made, the most accurate) |
| **Chart for an analysed song** | `import chart for current song` | replaces the AI melody with the chart |

**YouTube:** this is for personal, local use only, and it's off by default. Downloading may be against YouTube's Terms of Service, which is your decision. Only ordinary public videos work: no DRM content, no live streams, no playlists. Downloaded audio stays in `analyzer/data/`, and you can delete any song from the library.

**Where songs are kept:**

- **Featured songs** are listed in [`analyzer/featured.json`](analyzer/featured.json). Each one is the plain studio recording, found with YouTube Music's songs-only search: an auto-generated "art track", so there's no video intro, dialogue or sound effects. The server analyses them once and keeps them for good. To prepare any that aren't ready, run `curl -X POST localhost:8787/api/featured/prepare`, or click "prepare" on the start page. To add a song, append `{"title", "artist", "lang"}` to the file and prepare again; the video id is filled in automatically.
- **Your songs** are the ones you add or open. Nothing is stored on the phone: every song lives on the server and its VPS copy, and streams when opened. Your song list, settings and scores are in your account (PostgreSQL), so they follow you to any device. Browsers that still hold copies from older versions hand them to the server once (`/restore`, then copied to the VPS) and free the space.
- **Search** (`/api/catalog`) lists every stored YouTube song; each has a 10-second preview (`preview.m4a`, the most-sung stretch). Uploaded files are never searchable by others.
- **Stem format:** stems are stored as AAC (`.m4a`), about 8× smaller than WAV. Browsers decode it sample-accurately, so timing is unchanged. Key and speed renders share a separate `LEMO_VARIANT_CACHE_MB` (300 MB) budget, oldest dropped first. Older WAV songs are converted when the analyzer starts.

**Your account's data (local PostgreSQL):** while you're signed in, these follow your Google account:
- your settings
- the names of the songs you added
- per-song lyric edits, breath marks and timing tweaks
- your attempt history and scores

They're kept in a PostgreSQL database on the analyzer's machine (`DATABASE_URL` in `analyzer/.env`, used only by the analyzer, never sent to the browser). Each row belongs to one Google account, and nobody can read anyone else's. Song audio and analyses are **not** stored there; they stay on the analyzer and in your browser. The tables (`lemo_users`, `lemo_songs`, `lemo_prefs`) are created on first connect.

The browser keeps its own copy, so the app is instant and still works when the database is down. Changes upload in the background, and the newer copy wins. When a different person signs in on the same browser, the previous person's local data is cleared, never uploaded into the new account. `GET /api/health` shows whether the database is reachable.

Setup (once):

```bash
brew install postgresql@16 && brew services start postgresql@16
createuser -P lemo            # pick a password
createdb -O lemo lemo
createdb -O lemo lemo_test    # for the analyzer's tests
# analyzer/.env:  DATABASE_URL=postgresql://lemo:<password>@localhost:5432/lemo
```

**Lyrics:** when an analysed song opens, lemo asks several free sources at once:
- **LRCLIB:** community synced lyrics.
- **NetEase Cloud Music:** a big synced catalogue, including Bollywood.
- **The video's own captions:** when it's a YouTube song. Only captions the uploader added count, never auto-generated speech-to-text, and English captions on a Hindi or Urdu video count as a translation.
- **lyrics.ovh:** plain text only, as a last resort.

Synced lyrics with a matching song length win, and a toast says which source was used. Each word is then timed to the singer by forced alignment to the separated vocal (torchaudio MMS_FA: free, and its ~1.2 GB model downloads once). Lyrics in Hindi script are aligned through their Hinglish reading. Until alignment is done, or for lines it can't align, word timing is *estimated* from the melody's note starts and marked ≈. You can also paste or import lyrics (`.txt` / `.lrc`) in the lyrics editor. Untimed lyrics are never given made-up timestamps: use **tap-sync** or type times by hand.

**Lyrics script:** the 文/A menu in the top bar shows lyrics in Hinglish, हिंदी or اردو, or as found. Timing is kept word for word.
- **Hindi → Hinglish:** built-in rules, offline (मुझको इतना बताए कोई → Mujhko itna bataye koi).
- **Hinglish → Hindi or Urdu script:** Google input tools; results are cached.
- **Mixed lines:** when a line already has several scripts (captions often do), the part in the chosen script is kept and an English translation after it is dropped.
- **Urdu-only lines:** Urdu leaves out most vowels and can't be read back reliably, so those lines stay as found and the app says so. The stored lyrics never change, only how they're shown.

---

## Using it

| Key | Action |
|---|---|
| `space` | play / pause |
| `tab` | retry current phrase |
| `←` / `→` | previous / next phrase (`shift` = ±5 s) |
| `l` | loop current phrase |
| `t` | start / end a test |
| `m` | mic on/off · `n` mute |
| `b` | add a breath mark at the playhead |
| `k` | metronome (when tempo is known) |
| swipe left/right (or shift+scroll) on graph | move through the song · ⌘/pinch = zoom time · ⌥ = zoom pitch · click to jump |

- **Config bar:** speed (0.75×, 0.9×, 1×), key transpose (the backing *and* the target notes move together), loop, metronome, tolerance (±25/50/100¢), and notes/contour view.
- **Headphone delay:** if your line always trails the melody, open ⚙ → *headphone delay* and press + (20 ms steps), or click **fix sync** on the results after a test. lemo measures the lag from your take and re-aligns it. This moves the graph slightly later than the audio so it matches what you hear.
- **Latency:** in settings → calibrate, tap along to clicks with the headphones you'll sing with. Bluetooth headphones usually need 150–300 ms. Wired headphones are strongly recommended, because speakers leak into the mic.
- **Tests:** press ● next to ▶ (or `T`) to start a test from the playhead, or ↻● to start one from the very beginning (⏮ just jumps to the beginning). The options fold away and pausing keeps the test going. Press ■ to end it; that's final. The results then show (click a score to shade that aspect in red on the graph), and your take is loaded, so ▶ plays it with the music. The results focus on the part you sang: the rest of the song fades out, and playback and seeking stay inside that section. Switch **you | original** while it plays, flip **results | lyrics**, and press ✕ to go back to practice.
- **Listen back (older notes):** after a take, press **listen** on the results. The mic turns off and the page switches to a calm listening layout: the extra controls fold away and the graph grows. Your recorded voice plays with the music, aligned to the song. The **you | original** switch (or **V**) swaps between your voice and the original singer instantly, without pausing, so you can compare line by line. The second volume slider controls whichever voice you're hearing. **Esc** or ✕ takes you back to singing.
- **Themes:** studio (graphite and brass, the default), ink, sage, velvet and mono, all in settings. Each is a neutral dark base with one accent colour.
- **Breath marks:** filled ▼ = yours (verified), hollow ▽ = suggested from real gaps between phrases.

---

## How singing is evaluated (and its limits)

lemo does **not** require you to match the original singer's exact pitch or octave. By default (**melody shape** mode) you can sing in whatever key and register suits your voice. Five independent metrics are scored separately, and each is either 0–100% or **"—"** with a reason when it can't be measured honestly. All of them are pure functions with unit tests in [`web/src/lib/evaluation.ts`](web/src/lib/evaluation.ts).

| Metric | What it compares | Not penalised |
|---|---|---|
| **Melody shape** | Direction of each move (up / down / steady, 40%), size of each interval (40%), and how well you stay in your own key (20%). Your key offset is estimated robustly (median), and occasional octave jumps are folded out and reported. | Singing in a different key or octave. |
| **In tune with the music** | Is your key the song's key, or an exact octave of it? When the chords are known, do your notes fit them? Singing the right melody in the wrong key clashes with the backing, so this also **caps the overall score** (fully out of key means at most half marks). | Singing an octave up or down. |
| **Tone clarity** | How clean your voice is on the notes (how periodic it is). Breathy, raspy or strained singing scores lower. This is a proxy for a clean sound, not a judge of taste; a noisy room or poor mic lowers it too. | Quiet passages buried in background noise (not judged). |
| **Note attack** | Landing straight on each note vs. sliding or scooping up into it (time to settle on pitch). | Notes that continue smoothly from the previous one. |
| **Rhythm & phrasing** | Note starts (in legato lines, the moment the pitch crosses to the new note), phrase endings, and whether you leave the rests empty. | Expressive timing within ±80 ms. Unvoiced consonants. |
| **Stability** | Pitch steadiness on long notes (≥0.45 s): leftover jitter and slow drift, after fitting a 4–8 Hz sinusoid. | Healthy vibrato (a straight note and a good vibrato score the same). Very wide vibrato (>±120¢) is flagged as wobble. |
| **Dynamics** | How your loudness rises and falls compared with the reference vocal, measured against *your own* median level (correlation + average difference), and whether you follow its soft and powerful sections. | Mic gain or distance (only relative changes count). Frames close to the room noise or backing leakage are ignored. |
| **Exact pitch** *(optional mode)* | Original pitch and octave, after the **key ±** transpose (backing and target move together). | Silence or breaths (they lower coverage but are never "wrong notes"). |

- **Overall** is a weighted mean of whichever metrics could be measured, put through a grading curve (score^1.2: 95 → 94, 85 → 82, 75 → 71, 65 → 60). Near-perfect singing keeps its marks, while middling singing doesn't look like a B. It uses the weights shown right under it (default 30 shape, 25 in tune with the music, 20 rhythm, 15 tone, 15 stability, 10 attack, 15 dynamics, plus 30 exact when that mode is on). You can change the weights, or hide the overall score, in settings. It's a practice summary, not a verdict on your singing.
- **Silence is never rewarded.** If you sing too few notes, every metric shows "not enough to judge" and there is no overall score.
- **Time alignment:** a global lag of up to ±250 ms is estimated, so latency doesn't distort shape, stability or dynamics. Rhythm is judged on your raw timing, and the lag is reported separately.
- **Harmony (informational, never scored):** when reliable chord data exists, lemo flags notes that clash with the accompaniment, and warns if your chosen key clashes with the backing (then use **key ±** to move the music). The demo's chords are exact. For analysed songs they're estimated from the backing with triad matching, and only segments that clearly match a chord are kept.
- **Live guidance:** "go higher / go lower" is relative to *your* key in shape mode. "softer / more intensity" only appears when your signal is clearly above the background, and it compares your level to your own median. lemo never tells you to sing louder just because the mic signal is weak.

**Graph layers** (toggles in the top bar): **shape line** (your voice shifted into the song's key), **exact line** (your true pitch), **loudness** (a separate lane: reference filled, you as a line, both relative, so loudness and pitch never mix), and **timing** (phrase boundaries, plus a marker showing when you started each note).

Limits, honestly:
- lemo measures pitch shape, timing, steadiness and relative loudness: not tone, breath support, diction or emotion.
- Dynamics need reference loudness. The demo and analysed songs have it; charts (UltraStar/MIDI) don't, so dynamics shows "—" for them.
- AI melody extraction works well on clear lead vocals. It can struggle with heavy harmonies, doubled or ad-lib vocals, vocoders and very breathy singing. When it matters, use a chart.
- Microphone pitch detection is monophonic. Speakers, other voices or a noisy room will confuse it.
- The ±50¢ default is a practice setting, not a musical standard. Tighten it as you improve.

---

## Song storage on a VPS

Analysis runs on this machine; finished songs live on a VPS (`LEMO_REMOTE_*` in `analyzer/.env`):

- **Copying:** after each analysis the song's files are copied to the VPS over SSH (rsync). Dropped connections are retried and half-sent files resume. A background check every 5 minutes copies anything still missing.
- **Serving:** the VPS's nginx serves them at `https://<domain>/lemo-songs/…` **only** through signed links that expire (`snippets/lemo-songs.conf`, nginx `secure_link`). Unsigned links get 403, expired ones 410.
- **This machine is a cache:** songs safe on the VPS are dropped here beyond `LEMO_LOCAL_CACHE_MB` (2 GB). When a browser asks for one that isn't here, it's sent straight to the VPS. The analyzer fetches a song back only when it needs the files itself (key / speed renders, word timing).
- **The song limit:** `LEMO_SONG_LIMIT_GB` (10 GB) counts space on the VPS. New songs also stop if the VPS disk gets down to `LEMO_REMOTE_MIN_FREE_GB` (1.5 GB) free, so lemo never starves other apps there.
- **Deleting:** deleting a song deletes its VPS copy too.

## On phones

lemo is laid out for phones first. On narrow screens:
- **Controls bar:** keeps speed, key and settings; metronome, breath marks and the lyrics script move into a ⋯ menu.
- **Player:** puts both volume sliders behind one button.
- **Song name:** gets its own line under the header.
- **Dialogs:** open as bottom sheets.
- **Touch:** drag the graph sideways to move through the song (a tap jumps there), and long-press any control to read what it does.

**Headphones:** when you turn the mic on, lemo checks where the sound is going. Some browsers name the outputs (AirPods, headphones, "MacBook Air Speakers"); iPhones don't.
- **Headphones:** nothing is shown.
- **The speaker, or can't tell:** a note explains why headphones matter, with the music paused meanwhile. On a speaker, the mic hears the song and the original singer, so their voice ends up in your line and score.
- **Your answer:** it holds for the visit. Unplugging headphones mid-session brings the note back.

## Architecture

```
web/ (React + Vite + TS + Tailwind)
  src/lib/          pure, tested logic: music math, YIN, tracker, scoring, phrases, parsers
  src/audio/        engine.ts (sample-accurate stem playback on one AudioContext clock)
                    mic.ts → public/capture-worklet.js (AudioWorklet) → pitch.worker.ts (YIN in a Web Worker)
                    demo.ts (synthesised demo; speed/key re-rendered exactly)
  src/render/       graph.ts: canvas pitch graph, drawn per frame outside React
  src/state/        studio.ts: controller (takes, scoring, loop); persist.ts (localStorage)
  src/components/   UI (Geist Sans / Geist Mono)

analyzer/ (Python, FastAPI): local analysis service
  lemo_analyzer/youtube.py     yt-dlp fetch (opt-in)
  lemo_analyzer/audio.py       ffmpeg decode, Rubber Band speed/transpose variants (cached)
  lemo_analyzer/separation.py  Demucs htdemucs, chunked (progress + cancel)
  lemo_analyzer/melody.py      CREPE / pYIN contour → note segmentation, tempo
  lemo_analyzer/jobs.py        background jobs with stages, cancellation, disk cache
  lemo_analyzer/userdata.py    your account's settings, song list and per-song data (PostgreSQL)
  lemo_analyzer/auth.py        Google sign-in check (Firebase ID tokens) on every API request
  lemo_analyzer/remote.py      song files on the VPS: copy, fetch back, signed nginx links
  lemo_analyzer/worker.py      runs heavy work in a separate low-priority process, one at a time
  lemo_analyzer/storage.py     featured songs (featured.json), cache budget + trimming, WAV→AAC migration
  lemo_analyzer/lyrics.py      LRCLIB lookup
```

**Light on memory:** the analyzer server itself stays small (~70 MB) because it never loads the AI models. Vocal separation, pitch tracking and word timing each run in their own short-lived, low-priority process, one at a time. All their memory goes back to the system the moment they finish, and the browser always gets the CPU first. Featured songs are prepared only while nobody is practising: an open song sends a small heartbeat every minute, and preparation waits until it has been quiet for 3 minutes. A song you add yourself always goes first; a featured song in progress is stopped and redone later. Key/speed renders also run one at a time, at low priority.

**Why it stays smooth:** microphone analysis runs in an AudioWorklet plus a Web Worker (~94 analyses/s), so it doesn't depend on rendering and keeps going in background tabs. The graph is a canvas redrawn each animation frame while anything moves; when paused with nothing changing, it isn't redrawn at all. React only re-renders when something you can see changes, like the lyric word or the phrase.

**Speed and transpose** never resample audio. The demo is re-synthesised, and analysed songs are rendered by Rubber Band on the analyzer (formant-preserving for the vocal stem). The reference melody is shifted by the same interval.

### API (analyzer)

| Method | Path | |
|---|---|---|
| GET | `/api/health` | capabilities (youtube, demucs, model, device, sign-in); the only route open without signing in |
| POST | `/api/songs/analyze` | form `url=` (YouTube) or multipart `file=` → job |
| GET | `/api/songs` | cached songs that aren't featured |
| GET | `/api/me` | your settings + song list (creates your profile) |
| PUT | `/api/me/settings`, `/api/me/prefs/{song}` | save, if newer (`updatedAt`) |
| GET | `/api/me/prefs/{song}` | your data for one song |
| PUT / DELETE | `/api/me/songs/{song}` | your song list (names only) |
| GET | `/api/featured` | featured songs with ready / progress |
| POST | `/api/featured/prepare` | find + analyse featured songs that aren't ready (background, one at a time) |
| POST | `/api/songs/{id}/restore` | multipart `reference`, `backing`, `vocals`: a browser re-sends a song the cache dropped |
| GET | `/api/songs/{id}/status` | stage, progress, message, error |
| POST | `/api/songs/{id}/cancel` | cancel a running job |
| GET | `/api/songs/{id}/reference` | `ReferenceTrack` JSON (notes, contour, tempo) |
| GET | `/api/songs/{id}/audio/{backing\|vocals}?speed=&semitones=` | AAC stem / rendered variant |
| DELETE | `/api/songs/{id}` | delete cached song |
| GET | `/api/lyrics?title=&artist=&duration=` | LRCLIB lookup |

Configuration is in [`analyzer/.env.example`](analyzer/.env.example). Copy it to `analyzer/.env`.

---

## Tests

```bash
npm test                 # web (vitest) + analyzer (unittest)
npm --prefix web test    # frequency↔MIDI, cents, YIN on known test signals, confidence/silence filtering,
                         # octave errors, scoring, time alignment, seeking, looping, chart/LRC parsing
npm run test:analyzer    # note segmentation (vibrato, scoops, tuning), YouTube URL validation
```

Test signals with known pitches (sines, harmonic "voice" tones, noise) are in [`web/src/lib/testSignals.ts`](web/src/lib/testSignals.ts).

**End-to-end self-test (dev):** load the demo, then run `await lemo.debugLoopback()` in the browser console and press play. This sends the demo's guide vocal through the exact mic pipeline (worklet → worker → scoring). It should score close to 100%.
