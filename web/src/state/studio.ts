// The studio controller: owns the playback engine, microphone, takes and
// scoring, and drives the per-frame render loop. React subscribes to a small
// snapshot that only changes on user-visible state changes (not per frame).

import { analyzer } from '../api/analyzer'
import { levelTake } from '../lib/level'
import { demoSource, demoTrack } from '../audio/demo'
import { analyzerSource, fileSource, PlaybackEngine, type AudioSource } from '../audio/engine'
import { isBluetoothMic, MicError, MicInput, type MicReading } from '../audio/mic'
import { midiToNoteName } from '../lib/music'
import { tidyTitle } from '../lib/titles'
import { parseLrc } from '../lib/parsers/lrc'
import { parseMidi } from '../lib/parsers/midi'
import { applyChart, parseUltraStar } from '../lib/parsers/ultrastar'
import { buildPhrases, lyricLineAt, phraseAt, plainTextToLines, suggestBreaths } from '../lib/phrases'
import { lineEnd, lyricGate, retextLine, withWordTiming } from '../lib/lyricTiming'
import { CoachState, voiceIssue, type VoiceIssue } from '../lib/voiceCoach'
import { reviewNotes, type NoteReview, type ReviewAspect } from '../lib/review'
import { chordAt, clashesWith, DEFAULT_EVAL, evaluate, liveGuidance, type EvalSettings, type Evaluation, type LiveGuidance } from '../lib/evaluation'
import { formatTime, median } from '../lib/music'
import { noteAt, type LiveState } from '../lib/scoring'
import { phraseLoop, type LoopRegion } from '../lib/timeline'
import type { Attempt, BreathMark, LyricLine, NoteResult, Phrase, ReferenceNote, ReferenceTrack, UserFrame } from '../lib/types'
import type { GraphRenderer, GraphView } from '../render/graph'
import { events } from './events'
import { NO_FX, shiftCurve, STEP, type VoiceFx } from '../lib/voiceFx'
import type { FxIn, FxOut } from '../audio/voiceFx.worker'
import { persist, type Settings, type SongPrefs } from './persist'
import { packFrames, TOP_MIN_SECONDS, unpackFrames, wavOf } from '../lib/topTake'

export type MicState = 'off' | 'starting' | 'on' | 'error'

export interface Snapshot {
  track: ReferenceTrack | null
  caps: { canSpeed: boolean; canTranspose: boolean; hasGuide: boolean } | null
  busy: string | null
  /** 0..1 while audio downloads / converts / decodes (null: no measurable progress) */
  busyProgress: number | null
  /** what's happening right now under the busy label, e.g. "downloading · 3.1 / 5.9 MB" */
  busyDetail: string | null
  playing: boolean
  speed: number
  transpose: number
  loop: LoopRegion | null
  metronome: boolean
  phrases: Phrase[]
  phrase: number
  breaths: BreathMark[]
  lyrics: LyricLine[]
  lyricPos: { line: number; word: number }
  mic: MicState
  micError: string | null
  muted: boolean
  /** during a test: what's stopping the mic from hearing the singer well (shown as a note) */
  voiceIssue: VoiceIssue | null
  settings: Settings
  attempts: Attempt[]
  lastResult: Evaluation | null
  offsetMs: number
  error: string | null
  /** A recorded take is available to listen back to. */
  canReplay: boolean
  /** Listening back to your take (mic off, focused layout). */
  replay: boolean
  /** Which vocal is audible while listening back. Switching never pauses the song. */
  listenSource: 'me' | 'original'
  /** Effects on your voice when listening back (results screen). */
  voiceFx: VoiceFx
  /** A new pitch / tune for your voice is being rendered */
  voiceFxBusy: boolean
  /**
   * A test is running: started by singing (playing with the mic on), kept
   * through pauses, ended with "end" / Esc / mic off / song end. Options are
   * locked while it runs; results appear when it ends.
   */
  session: boolean
  /** Background lyric work in progress, e.g. "finding lyrics" / "timing words". */
  /** the lyrics as displayed: in the script chosen in settings (the stored ones stay as found) */
  lyricsShown: LyricLine[]
  lyricsStatus: string | null
  /** Why word timing is only estimated (e.g. alignment model unavailable). */
  lyricsNote: string | null
  toast: { id: number; text: string } | null
  /** What the results screen is highlighting on the graph. */
  reviewAspect: ReviewAspect
  /** After a test: show the results or the lyrics in the bottom panel. */
  resultsView: 'results' | 'lyrics'
  /** Results mode: the sung section that playback, seeking and the graph focus on. */
  focus: { start: number; end: number } | null
  /** The difficulty and scoring mode the shown result was scored with. */
  resultMode: { toleranceCents: number; scoringMode: 'shape' | 'exact' } | null
  /**
   * Your result made today's top: its place (saving: being sent) and whether everyone
   * can hear your voice — you're asked first ('ask').
   */
  topRank: { rank: number; id: string | null; saving: boolean; voice: 'ask' | 'sending' | 'shared' | 'no' } | null
  /** The result shown is someone's take from today's top, not yours. */
  viewing: { id: string; name: string; photo: string | null; rank: number | null; hasVoice: boolean } | null
}

/** The last take's voice, in memory (uploaded only when it makes today's top, and only if you share). */
interface RecordedTake {
  samples: Float32Array
  sampleRate: number
  /** Song time of the first sample (latency-compensated, like the pitch frames). */
  start: number
  speed: number
  transpose: number
  from: number
  /** Song time of the last sung moment. */
  to: number
  frames: UserFrame[]
}

export interface LiveInfo {
  time: number
  duration: number
  level: number
  state: LiveState
  cents: number | null
  midi: number | null
  target: number | null
  label: string
  lastPass: number | null
  guidance: LiveGuidance
  /** Singer's key relative to the reference (semitones), estimated from recent notes. */
  keyOffset: number | null
  /** Sung note clashes with the accompaniment chord (only when harmony is reliable). */
  clash: boolean
  exact: boolean
}

type Listener = () => void

export class Studio {
  private engine: PlaybackEngine | null = null
  private mic = new MicInput()
  private listeners = new Set<Listener>()
  private liveListeners = new Set<(l: LiveInfo) => void>()
  private renderer: GraphRenderer | null = null
  private raf = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private baseTrack: ReferenceTrack | null = null
  private prefs: SongPrefs = {}

  // high-frequency state (never in the React snapshot)
  private frames: UserFrame[] = []
  private ghost: UserFrame[] = []
  private results = new Map<number, NoteResult>()
  private takeFrom: number | null = null
  private nextScore = 0
  private live: LiveInfo = {
    time: 0, duration: 0, level: 0, state: 'idle', cents: null, midi: null, target: null, label: '', lastPass: null,
    guidance: { pitch: null, cents: null, dynamics: null }, keyOffset: null, clash: false, exact: false,
  }
  // Relative loudness tracking (dB). Only ever compared to the singer's own median.
  private voicedLevels: number[] = []
  private unvoicedLevels: number[] = []
  private levelBase: number | null = null
  private levelFloor = -90
  private levelEma: number | null = null
  private refLoudMedian = 0
  private clashFrames = 0
  private lastLiveEval = 0
  // Recording of the current take (raw mic samples) and the last finished one.
  private recChunks: Float32Array[] = []
  private recStart: number | null = null
  private recLen = 0
  /** Best evaluation of the running test (shown when it ends). */
  private sessionEval: Evaluation | null = null
  /** Analyzer song id of the loaded song (null for the demo / local files). */
  private analyzerId: string | null = null
  private lyricsJob = 0
  private reviewCache: { key: unknown[]; map: Map<number, NoteReview> } | null = null
  private lastTake: RecordedTake | null = null
  private static MAX_REC_SEC = 600
  private lastLiveEmit = 0
  private lastLevelStats = 0
  private lastView: GraphView | null = null
  /** The take's frames / results grow in place, so their sizes are tracked separately. */
  private lastSizes = ''
  /** Set whenever app state changes, so the next frame redraws. */
  private viewDirty = true

  constructor() {
    this.mic.onReading = (r) => this.onMicReading(r)
    this.mic.onChunk = (samples, endFrame) => this.onMicChunk(samples, endFrame)
  }

  snap: Snapshot = {
    track: null, caps: null, busy: null, busyProgress: null, busyDetail: null, playing: false, speed: 1, transpose: 0, loop: null, metronome: false,
    phrases: [], phrase: -1, breaths: [], lyrics: [], lyricPos: { line: -1, word: -1 }, mic: 'off', micError: null,
    muted: false, voiceIssue: null, settings: persist.settings(), attempts: [], lastResult: null, offsetMs: 0, error: null,
    canReplay: false, replay: false, listenSource: 'me', voiceFx: NO_FX, voiceFxBusy: false, session: false, lyricsShown: [], lyricsStatus: null, lyricsNote: null, toast: null, reviewAspect: 'pitch', resultsView: 'results', focus: null, resultMode: null,
    topRank: null, viewing: null,
  }

  // ---- subscription ---------------------------------------------------------

  subscribe = (fn: Listener) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getSnapshot = () => this.snap
  onLive(fn: (l: LiveInfo) => void) {
    this.liveListeners.add(fn)
    fn(this.live)
    return () => void this.liveListeners.delete(fn)
  }
  private set(patch: Partial<Snapshot>) {
    if (patch.busy !== undefined) {
      // a new (or no) busy task starts with no progress
      patch = { busyProgress: null, busyDetail: null, ...patch }
      this.stemFrac = { backing: 0, vocals: 0 }
      this.stemDetail = { backing: '', vocals: '' }
      this.stemBytes = { backing: [0, 0], vocals: [0, 0] }
    }
    this.snap = { ...this.snap, ...patch }
    this.viewDirty = true
    this.listeners.forEach((l) => l())
  }

  attachRenderer(r: GraphRenderer | null) {
    this.renderer = r
    if (r) this.startLoop()
  }

  // ---- engine ---------------------------------------------------------------

  private ensureEngine(): PlaybackEngine {
    if (!this.engine) {
      const e = new PlaybackEngine()
      e.onDiscontinuity = () => this.endTake()
      e.onEnded = () => {
        this.set({ playing: false })
        this.endSession()
      }
      e.subscribe(() => {
        if (this.snap.playing !== e.playing) this.set({ playing: e.playing })
      })
      this.engine = e
      this.applyVolumes()
    }
    return this.engine
  }

  /**
   * Headphone delay: how far behind the scheduled audio you actually hear it.
   * The graph (playhead + melody) is drawn this much later, and your voice is
   * aligned with the same value, so lines match what you hear.
   */
  setHeadphoneDelay(ms: number | null) {
    this.updateSettings({ latencyMs: ms === null ? null : Math.max(0, Math.min(500, Math.round(ms))) })
    this.renderOnce()
  }

  /**
   * After a test: apply the measured lag between your line and the melody as
   * extra headphone delay, and re-align the take you just sang so the results
   * reflect it straight away.
   */
  applySyncFix(lagMs: number) {
    const before = this.latencySec * 1000
    this.setHeadphoneDelay(before + lagMs)
    const dt = (this.latencySec * 1000 - before) / 1000
    const take = this.lastTake
    const track = this.snap.track
    if (!take || !track || !dt) return
    for (const f of take.frames) f.t -= dt
    take.start -= dt
    take.from -= dt
    take.to -= dt
    const ev = evaluate(track.notes, take.frames, take.from, take.to, this.evalSettings(), track.harmony)
    if (this.engine?.playing) this.engine.pause()
    const e = this.engine
    if (e && this.snap.replay) {
      const buf = e.ctx.createBuffer(1, take.samples.length, take.sampleRate)
      buf.copyToChannel(this.playable(take) as Float32Array<ArrayBuffer>, 0)
      e.setVoice({ buffer: buf, start: take.start })
    }
    this.reviewCache = null
    this.set({ lastResult: ev })
    this.renderVoiceFx() // the tune follows the corrected timing
    this.toast(`headphone delay set to ${Math.round(this.latencySec * 1000)} ms`)
  }

  get latencySec(): number {
    const s = this.snap.settings
    if (s.latencyMs !== null) return s.latencyMs / 1000
    return (this.engine?.outputLatency ?? 0.02) + 0.015
  }

  /** The song time the singer is hearing now (playhead). */
  heardTime(): number {
    const e = this.engine
    if (!e) return 0
    e.heardLag = this.latencySec
    return e.heardTime()
  }

  get audioContext() {
    return this.ensureEngine().ctx
  }

  playClick(when: number) {
    this.ensureEngine().click(when)
  }

  // ---- loading songs ---------------------------------------------------------

  private loadSeq = 0

  /**
   * Before any song opens: nothing of the previous one carries over. Playback stops,
   * a running test is dropped (not scored), the results' window and your take go,
   * and lyrics work still running for the old song is cancelled. Returns this load's
   * number: a load that's been overtaken by a newer one stops quietly.
   */
  private beginLoad(): number {
    const seq = ++this.loadSeq
    const e = this.engine
    if (e?.playing) e.pause()
    if (this.snap.session) {
      this.sessionEval = null
      this.set({ session: false })
    }
    this.endTake()
    if (e) {
      e.window = null
      e.loop = null
      e.setVoice(null)
    }
    this.lastTake = null
    this.frames = []
    this.ghost = []
    this.results.clear()
    this.reviewCache = null
    this.fxId++ // a voice-effects render still running for the old take is ignored
    this.lyricsJob++
    this.set({
      lastResult: null, focus: null, replay: false, canReplay: false, resultsView: 'results', resultMode: null, topRank: null, viewing: null,
      voiceFxBusy: false, lyricsStatus: null, lyricPos: { line: -1, word: -1 }, loop: null,
    })
    return seq
  }

  /** Back to the start ("what are we singing today?"): the song stops and closes. */
  goHome() {
    this.beginLoad()
    this.set({ track: null, busy: null, busyProgress: null, busyDetail: null, playing: false, phrases: [], phrase: -1, breaths: [], lyrics: [], lyricsShown: [], attempts: [], error: null })
  }

  async loadDemo() {
    const seq = this.beginLoad()
    this.analyzerId = null
    await this.loadTrack(demoTrack(), demoSource, 'rendering demo', seq)
  }

  /**
   * Open an analysed song. Every song streams from Lemody's server (the files live on
   * the VPS) — nothing is stored on the phone.
   */
  async loadAnalyzed(id: string) {
    const seq = this.beginLoad()
    this.set({ busy: 'loading song', error: null })
    try {
      const raw = await analyzer.reference(id)
      if (seq !== this.loadSeq) return // another song was opened meanwhile
      // YouTube titles carry cast lists, "8K Video Song" etc.: keep the song name and singer
      const ref = { ...raw, ...tidyTitle(raw.title, raw.artist) }
      this.analyzerId = id
      const fetchStem = async (stem: 'backing' | 'vocals', speed: number, semis: number, signal: AbortSignal) => {
        const original = speed === 1 && semis === 0
        // A new key / speed is converted on the analyzer first: follow its progress.
        let converting = !original
        if (converting) void this.followRender(id, stem, speed, semis, () => converting && !signal.aborted)
        const res = await this.fromAnalyzer(id, () => fetch(analyzer.stemUrl(id, stem, speed, semis), { signal }))
        converting = false
        const from = original ? 0 : 0.6
        const blob = await readWithProgress(res, (got, total) => this.stemBytes_(stem, got, total, from))
        this.stemProgress(stem, this.stemFrac[stem], 'getting it ready') // the bar stays the download's share
        return blob.arrayBuffer()
      }
      await this.loadTrack(ref, analyzerSource(ref.duration, fetchStem), 'loading audio', seq)
      if (seq !== this.loadSeq) return
      // on your song list (in your account), so it's one tap away on any device
      if (!ref.featured && this.analyzerId === id) {
        events.emit('songAdded', { id, title: ref.title, artist: ref.artist, duration: ref.duration, addedAt: Date.now() })
      }
    } catch (e) {
      this.set({ busy: null, error: (e as Error).message })
    }
  }

  private stemFrac = { backing: 0, vocals: 0 }
  private stemDetail = { backing: '', vocals: '' }
  private stemBytes: Record<'backing' | 'vocals', [got: number, total: number]> = { backing: [0, 0], vocals: [0, 0] }
  private lastProgress = 0

  /**
   * Bytes of one stem arrived. Both stems download together, so the text and the bar
   * count them together: "downloading · 3.1 / 7.4 MB" and the same share on the bar
   * (until both sizes are known, the bar follows each stem's own share).
   */
  private stemBytes_(stem: 'backing' | 'vocals', got: number, total: number, from: number) {
    this.stemBytes[stem] = [got, total]
    const [gb, tb] = this.stemBytes.backing
    const [gv, tv] = this.stemBytes.vocals
    const both = tb > 0 && tv > 0
    const frac = both ? (gb + gv) / (tb + tv) : total ? got / total : 0
    const detail = `downloading · ${both ? `${mb(gb + gv)} / ${mb(tb + tv)} MB` : `${mb(gb + gv)} MB`}`
    const at = from + (1 - from) * frac // the bar's share = the share of MB downloaded
    if (both) {
      // one count for both: the bar is exactly the combined share (never behind what it showed)
      const shown = Math.max(at, Math.min(this.stemFrac.backing, this.stemFrac.vocals))
      this.stemFrac = { backing: shown, vocals: shown }
      this.stemDetail = { backing: detail, vocals: detail }
    } else {
      this.stemFrac[stem] = Math.max(this.stemFrac[stem], at)
      this.stemDetail[stem] = detail
    }
    this.stemProgress(stem, this.stemFrac[stem], detail)
  }

  /** Both stems load side by side: the bar shows their average, the text the one that's behind. */
  private stemProgress(stem: 'backing' | 'vocals', frac: number, detail: string) {
    this.stemFrac[stem] = Math.max(this.stemFrac[stem], frac)
    this.stemDetail[stem] = detail
    const t = performance.now()
    if (t - this.lastProgress < 80 && frac < 1) return // ~12 updates a second is plenty
    this.lastProgress = t
    const fr = this.stemFrac
    const behind = fr.backing <= fr.vocals ? 'backing' : 'vocals'
    const which = behind === 'backing' ? 'music' : 'vocals'
    const text = this.stemDetail[behind]
    // downloading: one count for both stems; converting / decoding: the stem that's behind
    const label = !text ? null : text.startsWith('downloading') ? text : `${which} · ${text}`
    this.snap = { ...this.snap, busyProgress: (fr.backing + fr.vocals) / 2, busyDetail: label }
    this.listeners.forEach((l) => l())
  }

  /** Poll the analyzer's progress converting a stem to a new key / speed. */
  private async followRender(id: string, stem: 'backing' | 'vocals', speed: number, semis: number, going: () => boolean) {
    const q = new URLSearchParams({ stem, speed: String(speed), semitones: String(semis) })
    while (going()) {
      try {
        const st = (await (await fetch(`/api/songs/${id}/render-status?${q}`)).json()) as { state: string; progress: number }
        if (!going()) break
        if (st.state === 'queued') this.stemProgress(stem, 0, 'waiting for the analyzer')
        else if (st.state === 'rendering') this.stemProgress(stem, 0.6 * st.progress, `converting on the analyzer · ${Math.round(st.progress * 100)}%`)
      } catch {
        /* the stem request itself reports failures */
      }
      await new Promise((r) => setTimeout(r, 350))
    }
  }

  /** A request to the analyzer about a song. */
  private async fromAnalyzer(_id: string, req: () => Promise<Response>): Promise<Response> {
    const res = await req()
    if (!res.ok) throw new Error(`Could not load audio (${res.status}): ${await res.text()}`)
    return res
  }

  async loadLocalFile(file: File) {
    const seq = this.beginLoad()
    this.analyzerId = null
    this.set({ busy: 'decoding audio', error: null })
    try {
      const ctx = this.ensureEngine().ctx
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
      if (seq !== this.loadSeq) return
      const track: ReferenceTrack = {
        id: `local-${file.name}-${file.size}`,
        title: file.name.replace(/\.[^.]+$/, ''),
        duration: buffer.duration,
        notes: [],
        lyrics: [],
        lyricsTiming: 'none',
        sourceType: 'upload',
        analysisStatus: 'partial',
        melodySource: 'none',
        beatsPerBar: 4,
        warnings: ['No reference melody yet. Import a chart (UltraStar .txt / MIDI) or analyse it with the local analyzer.'],
      }
      await this.loadTrack(track, fileSource(buffer), 'loading', seq)
    } catch (e) {
      this.set({ busy: null, error: `Could not decode this audio file: ${(e as Error).message}` })
    }
  }

  private async loadTrack(track: ReferenceTrack, source: AudioSource, busy: string, seq = this.loadSeq) {
    const engine = this.ensureEngine()
    this.endTake()
    this.set({ busy, error: null, lastResult: null })
    try {
      await engine.setSource(source)
      if (seq !== this.loadSeq) return // overtaken by a newer song: that one sets everything up
      this.baseTrack = track
      this.prefs = persist.song(track.id)
      events.emit('songOpened', track.id) // your account may have newer data for it (see applyCloudPrefs)
      this.frames = []
      this.ghost = []
      this.results.clear()
      this.lastTake = null
      engine.setVoice(null)
      engine.loop = null
      engine.window = null
      engine.metronome = false
      this.set({
        caps: { canSpeed: source.canSpeed, canTranspose: source.canTranspose, hasGuide: source.hasGuide },
        busy: null,
        speed: 1,
        transpose: 0,
        loop: null,
        metronome: false,
        attempts: (this.prefs.attempts ?? []).filter((a) => a.scores),
        offsetMs: this.prefs.offsetMs ?? 0,
        canReplay: false,
        replay: false,
        session: false,
        focus: null,
        lastResult: null,
        resultsView: 'results',
        lyricPos: { line: -1, word: -1 },
      })
      this.sessionEval = null
      this.rebuildTrack()
      this.startLoop()
      void this.autoLyrics()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.set({ busy: null, error: (e as Error).message })
    }
  }

  /** Apply per-song overrides (chart, offset, lyrics, breaths) to the base track. */
  private rebuildTrack() {
    const base = this.baseTrack
    if (!base) return
    let t: ReferenceTrack = base
    if (this.prefs.chart) t = applyChart(t, this.prefs.chart.notes, this.prefs.chart.source, this.prefs.chart.tempo)
    const off = (this.prefs.offsetMs ?? 0) / 1000
    if (off) {
      t = {
        ...t,
        notes: t.notes.map((n) => ({ ...n, startTime: n.startTime + off, endTime: n.endTime + off })),
        contour: t.contour ? { ...t.contour, t0: t.contour.t0 + off } : undefined,
      }
    }
    const lyrics = withWordTiming(this.prefs.lyrics ?? t.lyrics, t.notes)
    // Analysed melodies only (charts and the demo are exact): use the lyrics as a gentle
    // hint and hide "vocal" notes that sit well away from any sung line.
    if (!this.prefs.chart && t.contour) {
      const g = lyricGate(t.notes, lyrics)
      if (g.spans) t = { ...t, notes: g.notes, voiceSpans: g.spans }
    }
    const phrases = buildPhrases(t.notes)
    const manual = this.prefs.breaths ?? []
    const suggested = suggestBreaths(phrases).filter((s) => !manual.some((m) => Math.abs(m.time - s.time) < 0.5))
    const e = this.engine
    if (e) {
      e.tempo = t.tempo ?? null
      e.firstBeat = t.firstBeat ?? 0
      e.beatsPerBar = t.beatsPerBar ?? 4
    }
    this.results.clear()
    const loud = t.notes.map((n) => n.loudness).filter((v): v is number => v !== undefined)
    this.refLoudMedian = loud.length ? median(loud) : 0
    this.set({ track: t, lyrics, lyricsShown: this.inScript(lyrics), phrases, breaths: [...manual, ...suggested].sort((a, b) => a.time - b.time) })
  }

  private savePrefs(patch: Partial<SongPrefs>) {
    if (!this.baseTrack) return
    this.prefs = persist.saveSong(this.baseTrack.id, { ...this.prefs, ...patch })
  }

  async importChart(file: File) {
    if (!this.baseTrack) {
      this.set({ error: 'Load the song audio first, then import its chart.' })
      return
    }
    try {
      const name = file.name.toLowerCase()
      if (name.endsWith('.txt')) {
        const c = parseUltraStar(await file.text())
        this.savePrefs({ chart: { notes: c.notes, source: 'UltraStar chart', tempo: c.bpm / 4 >= 40 ? c.bpm / 4 : undefined } })
      } else if (/\.(mid|midi|kar)$/.test(name)) {
        const c = parseMidi(await file.arrayBuffer())
        this.savePrefs({ chart: { notes: c.notes, source: `MIDI (${c.trackName})`, tempo: c.tempo } })
      } else {
        throw new Error('Unsupported chart. Use UltraStar .txt, .mid, .midi or .kar')
      }
      this.rebuildTrack()
    } catch (e) {
      this.set({ error: (e as Error).message })
    }
  }

  clearChart() {
    this.savePrefs({ chart: undefined })
    this.rebuildTrack()
  }

  async importLyrics(file: File) {
    const text = await file.text()
    this.setLyrics(file.name.toLowerCase().endsWith('.lrc') || /\[\d+:\d+/.test(text) ? parseLrc(text) : plainTextToLines(text))
  }

  /**
   * Replace the lyrics; words get estimated timing now and real alignment in the
   * background. Lyrics with no timing at all (pasted text, a video's description) are
   * first timed to the singer line by line. `mine`: the singer chose them (kept for good).
   */
  setLyrics(lines: LyricLine[], align = true, mine = true) {
    const timed = withWordTiming(lines, this.baseTrack?.notes ?? [])
    const t = this.baseTrack
    this.savePrefs({ lyrics: timed, lyricsMine: mine, lyricsFor: mine || !t ? undefined : lyricsKey(t) })
    this.rebuildTrack()
    this.set({ lyricPos: { line: -1, word: -1 } })
    // a new job only when work starts here (a caller's own job must stay current)
    if (lines.length && lines.every((l) => l.start === null)) void this.timePlainLyrics(++this.lyricsJob, mine)
    else if (align) void this.alignWords(++this.lyricsJob)
  }

  /** Plain lyrics → each line timed to the vocal (on the analyzer), with its words. */
  private async timePlainLyrics(job: number, mine: boolean) {
    const id = this.analyzerId
    if (!id) return
    const texts = this.snap.lyrics.map((l) => l.text)
    this.set({ lyricsStatus: 'timing the lyrics to the singer' })
    try {
      for (let tries = 0; tries < 300; tries++) {
        if (job !== this.lyricsJob) return
        const r = await analyzer.alignPlain(id, texts)
        if (job !== this.lyricsJob) return
        if (r.status === 'done' && r.lines) {
          const lines: LyricLine[] = r.lines.map((l, i) => ({
            id: `a${i}-${Date.now().toString(36)}`, start: l.start, end: l.end, text: l.text, verified: false,
            ...(l.words ? { words: l.words, wordsSource: 'aligned' as const } : {}),
          }))
          this.set({ lyricsStatus: null })
          this.setLyrics(lines, false, mine)
          return
        }
        if (r.status === 'failed') {
          this.set({ lyricsNote: `couldn't time these lyrics: ${r.error ?? 'unknown error'}` })
          break
        }
        if (r.message) this.set({ lyricsStatus: r.message })
        await new Promise((res) => setTimeout(res, 2000))
      }
    } catch {
      /* analyzer offline */
    }
    if (job === this.lyricsJob) this.set({ lyricsStatus: null })
  }

  /** On load: fetch synced lyrics if the song has none, then time the words to the singer. */
  private async autoLyrics() {
    const job = ++this.lyricsJob
    const track = this.snap.track
    if (!track || !this.analyzerId) return
    // lyrics found automatically for an older name of this song (it was renamed): look again
    if (this.prefs.lyrics && !this.prefs.lyricsMine && this.baseTrack && this.prefs.lyricsFor !== lyricsKey(this.baseTrack)) {
      this.savePrefs({ lyrics: undefined, lyricsFor: undefined })
      this.rebuildTrack()
    }
    if (!this.snap.lyrics.length) {
      this.set({ lyricsStatus: 'finding lyrics' })
      let lines: LyricLine[] = []
      try {
        const vid = this.analyzerId.startsWith('yt-') ? this.analyzerId.slice(3) : undefined
        const r = await analyzer.lyrics(track.title, track.artist ?? '', track.duration, vid, this.analyzerId ?? undefined)
        // Already in the script the singer reads? Take a version with the same timing in that script.
        const want = this.snap.settings.lyricsScript
        const alt =
          want !== 'original' && r.script !== want
            ? r.candidates.find((c) => c.synced && c.script === want && c.duration && Math.abs(c.duration - track.duration) <= 2)
            : undefined
        const pick = alt ?? r
        if (!alt && r.timed?.some((l) => l.start !== null)) {
          // found and timed to the singer ahead of time: line and word timing ready to use
          lines = r.timed.map((l, i) => ({
            id: `t${i}-${Date.now().toString(36)}`, start: l.start, end: l.end, text: l.text, verified: false,
            ...(l.words?.length ? { words: l.words, wordsSource: 'aligned' as const } : {}),
          }))
        } else if (pick.synced) lines = parseLrc(pick.synced)
        else if (pick.plain) lines = plainTextToLines(pick.plain)
        if (lines.length) this.toast(`lyrics from ${pick.source}`)
      } catch {
        /* offline or not found — the lyrics area offers manual entry */
      }
      if (job !== this.lyricsJob) return
      if (!lines.length) return this.set({ lyricsStatus: null })
      this.setLyrics(lines, false, false)
      if (lines.every((l) => l.start === null)) return // being timed to the singer (timePlainLyrics)
    }
    await this.alignWords(job)
  }

  /** Ask the analyzer to force-align each line's words to the isolated vocal; merge when done. */
  private async alignWords(job: number) {
    const id = this.analyzerId
    if (!id) return
    const lines = this.snap.lyrics
    const todo = lines
      .map((l, i) => ({ l, i, end: lineEnd(lines, i) }))
      .filter((x) => x.l.start !== null && x.l.wordsSource !== 'aligned' && x.l.wordsSource !== 'chart')
    if (!todo.length) return
    const payload = todo.map((x) => ({ start: x.l.start!, end: x.end, text: x.l.text }))
    this.set({ lyricsStatus: 'timing words' })
    try {
      await this.fromAnalyzer(id, () => fetch(`/api/songs/${id}/status`))
      for (let tries = 0; tries < 400; tries++) {
        if (job !== this.lyricsJob) return
        const r = await analyzer.align(id, payload)
        if (job !== this.lyricsJob) return
        if (r.status === 'done' && r.lines) {
          const merged = [...this.snap.lyrics]
          todo.forEach((x, k) => {
            const w = r.lines![k]
            if (w && w.length && merged[x.i]?.text === x.l.text) merged[x.i] = { ...merged[x.i], words: w, wordsSource: 'aligned' }
          })
          this.savePrefs({ lyrics: merged })
          this.rebuildTrack()
          this.set({ lyricsNote: null })
          break
        }
        if (r.status === 'failed') {
          this.set({ lyricsNote: r.error ?? 'word alignment failed' })
          break
        }
        if (r.status === 'unavailable') break // this server doesn't time words: estimated timing stays
        if (r.message) this.set({ lyricsStatus: r.message })
        await new Promise((res) => setTimeout(res, 2000))
      }
    } catch {
      /* analyzer offline — estimated timing stays */
    }
    if (job === this.lyricsJob) this.set({ lyricsStatus: null })
  }

  // ---- lyrics script (Hinglish / Hindi / Urdu) ---------------------------------

  /** converted line text per "script\0original text"; null = can't be converted */
  private scriptCache = new Map<string, string | null>()
  private scriptPending = new Set<string>()
  /** lines whose conversion failed (analyzer offline): not asked again until the script setting changes */
  private scriptGaveUp = new Set<string>()

  /** The lyrics in the chosen script, from the cache; asks the analyzer for lines it hasn't converted yet. */
  private inScript(lines: LyricLine[]): LyricLine[] {
    const to = this.snap.settings.lyricsScript
    if (to === 'original' || !lines.length) {
      if (this.snap.lyricsNote?.startsWith('script:')) this.snap = { ...this.snap, lyricsNote: null }
      return lines
    }
    const todo: string[] = []
    let failed = 0
    const out = lines.map((l) => {
      const k = `${to}\0${l.text}`
      if (!this.scriptCache.has(k)) {
        if (l.text.trim() && !this.scriptPending.has(k) && !this.scriptGaveUp.has(k)) todo.push(l.text)
        return l
      }
      const v = this.scriptCache.get(k)
      if (v === null || v === undefined) {
        failed++
        return l
      }
      return v === l.text ? l : retextLine(l, v)
    })
    if (todo.length) void this.convertScript(to, todo)
    const name = to === 'latin' ? 'Hinglish' : to === 'deva' ? 'Hindi script' : 'Urdu script'
    const note = failed ? `script: ${failed} line${failed > 1 ? 's' : ''} can't be shown in ${name} (written in Urdu script, which leaves out vowels)` : null
    if (note !== this.snap.lyricsNote && (note || this.snap.lyricsNote?.startsWith('script:'))) this.snap = { ...this.snap, lyricsNote: note }
    return out
  }

  private async convertScript(to: 'latin' | 'deva' | 'urdu', texts: string[]) {
    const keys = texts.map((t) => `${to}\0${t}`)
    keys.forEach((k) => this.scriptPending.add(k))
    this.set({ lyricsStatus: 'converting lyrics' })
    try {
      const r = await analyzer.script(texts, to)
      keys.forEach((k, i) => this.scriptCache.set(k, r.lines[i] ?? null))
    } catch {
      keys.forEach((k) => this.scriptGaveUp.add(k))
      this.toast('could not convert the lyrics — is the analyzer running?')
    } finally {
      keys.forEach((k) => this.scriptPending.delete(k))
    }
    this.set({ lyricsStatus: null, lyricsShown: this.inScript(this.snap.lyrics) })
  }

  resetLyrics() {
    this.refindLyrics()
  }

  /** Forget the lyrics this song has (yours or found) and look them up again. */
  refindLyrics() {
    this.savePrefs({ lyrics: undefined, lyricsMine: undefined, lyricsFor: undefined })
    this.rebuildTrack()
    void this.autoLyrics()
  }

  setOffset(ms: number) {
    this.savePrefs({ offsetMs: ms })
    this.set({ offsetMs: ms })
    this.rebuildTrack()
  }

  /** Add a breath mark at the playhead — or remove one that's already right there. */
  addBreath(time = this.heardTime()) {
    if (!this.baseTrack) return
    if (!this.snap.settings.showBreaths) this.updateSettings({ showBreaths: true })
    const existing = this.prefs.breaths ?? []
    const near = existing.find((b) => Math.abs(b.time - time) < 0.5)
    if (near) {
      this.savePrefs({ breaths: existing.filter((b) => b !== near) })
      this.rebuildTrack()
      return this.toast(`breath mark removed · ${formatTime(time)}`)
    }
    this.savePrefs({ breaths: [...existing, { id: `m${Date.now().toString(36)}`, time, kind: 'manual' as const }] })
    this.rebuildTrack()
    this.toast(`▼ breath mark added · ${formatTime(time)}`)
  }

  /** A short message near the bottom that fades away — feedback for actions with no other visible effect. */
  toast(text: string) {
    const id = Date.now()
    this.set({ toast: { id, text } })
    setTimeout(() => this.snap.toast?.id === id && this.set({ toast: null }), 1800)
  }

  removeBreath(id: string) {
    this.savePrefs({ breaths: (this.prefs.breaths ?? []).filter((b) => b.id !== id) })
    this.rebuildTrack()
  }

  /** Promote a suggested breath to a verified manual one. */
  confirmBreath(b: BreathMark) {
    this.addBreath(b.time)
  }

  // ---- transport ------------------------------------------------------------

  async togglePlay() {
    const e = this.engine
    if (!e || !this.snap.track) return
    if (e.playing) {
      e.pause()
      // In a test, pausing keeps the take open — resume continues the same test.
      if (!this.snap.session) this.endTake()
    } else {
      await e.play()
    }
  }

  /**
   * Start a test from the playhead (or from the start of the last test when
   * you're looking at its results). Turns the mic on if needed.
   */
  async startTest(at?: number) {
    const e = this.engine
    if (!e || !this.snap.track || this.snap.session) return
    const restartAt = at ?? (this.snap.lastResult && this.lastTake ? Math.max(0, this.lastTake.from - 0.5) : null)
    this.leaveReview()
    if (!this.mic.active) {
      await this.toggleMic()
      if (!this.mic.active) return // permission denied etc. — the error is shown
    }
    if (e.playing) e.pause()
    this.endTake() // drop the practice line
    if (restartAt !== null) e.seek(restartAt)
    this.sessionEval = null
    this.set({ session: true, lastResult: null, resultsView: 'results', topRank: null, viewing: null })
    void analyzer.countTest(false)
    await e.play()
  }

  /** Start a new test from the very beginning of the song. */
  startTestFromBeginning() {
    return this.startTest(0)
  }

  /** Jump to the start of the song (or of the sung section, on the results). */
  goToBeginning() {
    this.seek(this.snap.focus?.start ?? 0)
  }

  toggleTest() {
    return this.snap.session ? this.endSession() : this.startTest()
  }

  /**
   * End the running test — final: it's scored, the results are shown and your
   * take is loaded so ▶ plays it back. Playing again never adds to this test.
   */
  endSession() {
    if (!this.snap.session) return
    const e = this.engine
    if (e?.playing) {
      this.heardTime()
      e.pause()
    }
    this.endTake()
    const ev = this.sessionEval
    this.sessionEval = null
    const st = this.snap.settings
    this.set({ session: false, lastResult: ev, resultsView: 'results', resultMode: { toleranceCents: st.toleranceCents, scoringMode: st.scoringMode } })
    if (ev) void this.enterReview()
    if (ev) void analyzer.countTest(true, Math.max(0, ev.to - ev.from))
    if (ev && this.analyzerId) {
      void analyzer.played(this.analyzerId) // counts towards Explore's most played
      void this.offerToTop(this.analyzerId)
    } else if (!ev) this.toast('test too short to score')
  }

  // your take as you hear it back: levelled (the raw recording is often much quieter than the song)
  private levelled = new WeakMap<object, Float32Array>()
  private playable(take: { samples: Float32Array }): Float32Array {
    let x = this.levelled.get(take)
    if (!x) this.levelled.set(take, (x = levelTake(take.samples)))
    return x
  }

  /** Results mode: mic off, your take ready to play with the music (switch you / original any time). */
  private async enterReview() {
    const e = this.engine
    const take = this.lastTake
    if (!e || !take) return
    if (this.mic.active) {
      this.micOff()
      this.set({ mic: 'off', micError: null, muted: false })
    }
    this.mic.muted = false
    const buf = e.ctx.createBuffer(1, take.samples.length, take.sampleRate)
    buf.copyToChannel(this.playable(take) as Float32Array<ArrayBuffer>, 0)
    e.setVoice({ buffer: buf, start: take.start })
    this.fxWorker().postMessage({ type: 'take', samples: this.playable(take).slice(), sampleRate: take.sampleRate } satisfies FxIn)
    e.voiceChain.set(this.snap.voiceFx)
    this.renderVoiceFx() // effects chosen on an earlier take carry over
    // Results only cover the part you sang: playback, seeking and the graph stay there.
    const focus = { start: Math.max(0, take.from - 0.6), end: Math.min(e.duration, take.to + 0.6) }
    e.window = focus
    this.set({ replay: true, listenSource: 'me', focus })
    this.applyVolumes()
    e.seek(focus.start)
  }

  /** ✕ on the results: back to practice (lyrics, options). */
  leaveReview() {
    if (this.engine?.playing) this.engine.pause()
    if (this.engine) this.engine.window = null
    this.set({ focus: null })
    this.exitReplay()
    // back to a clean practice view
    this.frames = []
    this.ghost = []
    this.results.clear()
    this.set({ lastResult: null, topRank: null, viewing: null })
    this.renderOnce()
  }

  // ---- today's top -------------------------------------------------------------------------

  /** Scored the same way for everyone (normal difficulty, melody shape, the default mix), so places are fair. */
  private topEval(take: RecordedTake, track: ReferenceTrack): Evaluation {
    return evaluate(track.notes, take.frames, take.from, take.to, DEFAULT_EVAL, track.harmony)
  }

  /**
   * A finished test that could make today's top: a library song, at least a minute of
   * it, normal speed, the original key. If its score makes the 100, its result and pitch
   * line are sent so others can open it; the voice only if the singer then shares it.
   */
  private async offerToTop(songId: string) {
    const take = this.lastTake
    const track = this.snap.track
    if (!take || !track || !this.snap.settings.shareTop || this.snap.viewing) return
    if (take.speed !== 1 || take.transpose !== 0 || take.to - take.from < TOP_MIN_SECONDS) return
    const ev = this.topEval(take, track)
    const score = ev.overall.score
    if (score === null) return
    try {
      const { rank } = await analyzer.topCheck(score)
      if (!rank || this.lastTake !== take) return
      this.set({ topRank: { rank, id: null, saving: true, voice: 'ask' } })
      const meta = {
        songId, title: track.title, artist: track.artist ?? null, score, seconds: take.to - take.from,
        from: take.from, to: take.to, start: take.start, keyOffset: ev.keyOffset,
        scores: { ...Object.fromEntries(Object.entries(ev.metrics).map(([k, m]) => [k, m.score])), overall: score },
        toleranceCents: DEFAULT_EVAL.toleranceCents, scoringMode: 'shape',
      }
      const res = await analyzer.topSubmit(meta, JSON.stringify(packFrames(take.frames)))
      if (this.lastTake !== take) return
      this.set({ topRank: res.rank ? { rank: res.rank, id: res.id, saving: false, voice: 'ask' } : null })
    } catch {
      if (this.lastTake === take) this.set({ topRank: null }) // offline etc.: it just doesn't count
    }
  }

  /** On today's top: let everyone hear your take. */
  async shareTopVoice() {
    const take = this.lastTake
    const top = this.snap.topRank
    if (!take || !top?.id || top.voice === 'sending') return
    this.set({ topRank: { ...top, voice: 'sending' } })
    try {
      await analyzer.topShareVoice(top.id, wavOf(take.samples, take.sampleRate))
      if (this.snap.topRank?.id === top.id) this.set({ topRank: { ...top, voice: 'shared' } })
    } catch (e) {
      if (this.snap.topRank?.id === top.id) this.set({ topRank: { ...top, voice: 'ask' } })
      this.toast(`couldn't share your voice: ${(e as Error).message}`)
    }
  }

  /** On today's top, without your voice (your score and pitch line still show). */
  keepTopVoicePrivate() {
    const top = this.snap.topRank
    if (top) this.set({ topRank: { ...top, voice: 'no' } })
  }

  /** Open a take from today's top: its song, its full result, and the singer's voice to play (if shared). */
  async openTopTake(id: string) {
    this.set({ busy: 'opening the take', error: null })
    try {
      const t = await analyzer.topTake(id)
      await this.loadAnalyzed(t.songId)
      const e = this.engine
      const track = this.snap.track
      if (!e || !track || this.analyzerId !== t.songId) return
      // no voice shared: a silent take, and the original singer plays instead
      let samples = new Float32Array(e.ctx.sampleRate)
      let sampleRate = e.ctx.sampleRate
      if (t.hasVoice) {
        this.set({ busy: 'loading their voice' })
        const audio = await e.ctx.decodeAudioData(await analyzer.topVoice(id))
        samples = audio.getChannelData(0)
        sampleRate = audio.sampleRate
      }
      const frames = unpackFrames(t.frames)
      const take: RecordedTake = {
        samples, sampleRate, start: t.meta.start, speed: 1, transpose: 0,
        from: t.meta.from, to: t.meta.to, frames,
      }
      this.lastTake = take
      this.frames = frames
      this.ghost = frames
      this.results.clear()
      this.reviewCache = null
      this.set({
        busy: null, canReplay: true, lastResult: this.topEval(take, track), resultsView: 'results',
        resultMode: { toleranceCents: DEFAULT_EVAL.toleranceCents, scoringMode: 'shape' },
        viewing: { id: t.id, name: t.name, photo: t.photo, rank: t.rank, hasVoice: t.hasVoice },
      })
      await this.enterReview()
      if (!t.hasVoice) {
        this.set({ canReplay: false })
        if (this.snap.caps?.hasGuide) this.setListenSource('original')
      }
    } catch (err) {
      this.set({ busy: null, error: (err as Error).message })
    }
  }

  setResultsView(v: 'results' | 'lyrics') {
    this.set({ resultsView: v })
  }

  seek(t: number) {
    this.engine?.seek(t)
    this.renderOnce()
  }

  /** Scroll the view through the song (pauses playback so the view stays put). */
  scrollBy(dt: number) {
    const e = this.engine
    if (!e || !dt) return
    if (e.playing) {
      this.heardTime() // refresh the ear-lag before pausing
      e.pause()
      this.endTake()
    }
    e.seek(e.time() + dt)
    this.renderOnce()
  }

  seekPhrase(delta: number) {
    const ph = this.snap.phrases
    if (!ph.length) return
    const cur = phraseAt(ph, this.heardTime())
    const idx = Math.max(0, Math.min(ph.length - 1, cur + delta))
    if (this.snap.loop) this.loopPhrase(idx)
    this.seek(Math.max(0, ph[idx].start - 1))
  }

  restartPhrase() {
    const ph = this.snap.phrases
    if (this.snap.loop) return this.seek(this.snap.loop.start)
    if (!ph.length) return this.seek(0)
    this.seek(Math.max(0, ph[Math.max(0, phraseAt(ph, this.heardTime()))].start - 1))
  }

  toggleLoop() {
    if (this.snap.session) return // options are locked during a test
    if (this.snap.loop) {
      if (this.engine) this.engine.loop = null
      this.set({ loop: null })
    } else {
      this.loopPhrase(Math.max(0, phraseAt(this.snap.phrases, this.heardTime())))
    }
  }

  private loopPhrase(idx: number) {
    const p = this.snap.phrases[idx]
    if (!p || !this.engine) return
    const loop = phraseLoop(p.start, p.end, this.engine.duration)
    this.engine.loop = loop
    this.set({ loop })
  }

  toggleMetronome() {
    if (!this.engine?.tempo || this.snap.session) return
    this.engine.metronome = !this.engine.metronome
    this.set({ metronome: this.engine.metronome })
  }

  async setVariant(speed: number, transpose: number) {
    const e = this.engine
    if (!e || !this.snap.caps || this.snap.session) return
    this.endTake()
    const label = speed !== this.snap.speed ? `rendering ${speed}×` : `transposing ${transpose > 0 ? '+' : ''}${transpose}`
    this.set({ busy: label, error: null })
    try {
      await e.setVariant(speed, transpose)
      this.results.clear()
      this.set({ busy: null, speed: e.speed, transpose: e.semitones })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') this.set({ busy: null, error: (err as Error).message })
    }
  }

  // ---- microphone -----------------------------------------------------------

  private btTipShown = false

  /** Mic off, and the sound straight back to full music quality (see engine.refreshOutput). */
  private micOff() {
    this.mic.stop()
    void this.engine?.refreshOutput()
  }

  async toggleMic() {
    if (this.mic.active) {
      this.endSession()
      this.endTake()
      this.micOff()
      this.set({ mic: 'off', micError: null })
      return
    }
    this.set({ mic: 'starting', micError: null })
    try {
      await this.mic.start(this.ensureEngine().ctx)
      this.set({ mic: 'on' })
      this.startLoop()
      // Still on a Bluetooth headset's mic (the phone has no other one to use): the
      // earphones are in call mode until the mic is off again — every phone does this
      if (isBluetoothMic(this.mic.deviceLabel) && !this.btTipShown) {
        this.btTipShown = true
        this.toast('Bluetooth earphones sound thinner while the mic is on — wired ones sound best')
      }
    } catch (e) {
      this.set({ mic: 'error', micError: e instanceof MicError ? e.message : (e as Error).message })
    }
  }

  /** Self-test: score the guide vocal as if it were the singer (latency 0). */
  async debugLoopback() {
    const e = this.ensureEngine()
    await this.mic.startFromNode(e.ctx, e.guideOutput())
    this.updateSettings({ latencyMs: 0 })
    this.set({ mic: 'on', micError: null })
    this.startLoop()
  }

  toggleMute() {
    this.mic.muted = !this.mic.muted
    this.set({ muted: this.mic.muted })
  }

  // ---- settings -------------------------------------------------------------

  /** Settings that came from your account (newer than this browser's). */
  applyCloudSettings(incoming: Partial<Settings>, at: number) {
    const settings = { ...persist.settings(), ...incoming } as Settings
    persist.saveSettings(settings, { at, fromCloud: true })
    const fixed = persist.settings() // re-read: validates / fills anything missing
    this.set({ settings: fixed })
    document.documentElement.dataset.theme = fixed.theme
    requestAnimationFrame(() => this.renderer?.refreshTheme())
    this.applyVolumes()
    this.set({ lyricsShown: this.inScript(this.snap.lyrics) })
    this.renderOnce()
  }

  /** A song's data from your account (newer than this browser's): lyrics edits, breath marks, scores … */
  applyCloudPrefs(id: string, prefs: SongPrefs) {
    persist.saveSong(id, prefs, { fromCloud: true })
    if (this.baseTrack?.id !== id) return
    this.prefs = prefs
    this.set({ attempts: (prefs.attempts ?? []).filter((a) => a.scores), offsetMs: prefs.offsetMs ?? 0 })
    this.rebuildTrack()
  }

  updateSettings(patch: Partial<Settings>) {
    const settings = { ...this.snap.settings, ...patch }
    persist.saveSettings(settings)
    this.set({ settings })
    if ('lyricsScript' in patch) {
      this.scriptGaveUp.clear()
      this.set({ lyricsShown: this.inScript(this.snap.lyrics) })
    }
    if ('theme' in patch) requestAnimationFrame(() => this.renderer?.refreshTheme())
    this.applyVolumes()
    this.renderOnce()
  }

  private applyVolumes() {
    const s = this.snap.settings
    this.engine?.setVolume('backing', s.backingVolume)
    const listen = this.snap.replay
    const me = this.snap.listenSource === 'me'
    // Both vocals keep running in sync; switching only crossfades their volumes.
    this.engine?.setVolume('guide', listen ? (me ? 0 : s.guideVolume || 0.8) : s.guideVolume)
    this.engine?.setVolume('voice', listen && me ? s.voiceVolume * this.snap.voiceFx.volume : 0)
  }

  // ---- disco lights ----------------------------------------------------------------------

  /** What the disco lights need each frame: the beat's strength and the singer's note. */
  discoFrame(): { bands: { sub: number; bass: number; mid: number; high: number; level: number; vocal: number }; midi: number | null; playing: boolean; beatIndex: number | null; barStart: boolean } {
    const e = this.engine
    const t = this.heardTime()
    const notes = this.snap.track?.notes ?? []
    const i = noteAt(notes, t)
    const bands = e?.bands() ?? { sub: 0, bass: 0, mid: 0, high: 0, level: 0 }
    // the song's own beat grid (measured when it was analysed)
    const tr = this.snap.track
    const beatLen = tr?.tempo ? 60 / tr.tempo : 0
    const k = beatLen ? Math.floor((t - (tr!.firstBeat ?? 0)) / beatLen) : null
    const per = tr?.beatsPerBar ?? 4
    return {
      bands: { ...bands, vocal: i >= 0 ? this.vocalRank(notes, i) : 0 }, midi: i >= 0 ? notes[i].midiPitch : null, playing: !!e?.playing,
      beatIndex: k, barStart: k !== null && ((k % per) + per) % per === 0,
    }
  }

  private loudRanks: { notes: ReferenceNote[]; sorted: number[] } | null = null
  /** How loud the singer sings this note against all their notes in the song, 0..1 (a percentile). */
  private vocalRank(notes: ReferenceNote[], i: number): number {
    if (this.loudRanks?.notes !== notes) {
      this.loudRanks = { notes, sorted: notes.map((n) => n.loudness).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b) }
    }
    const { sorted } = this.loudRanks
    const l = notes[i].loudness
    if (typeof l !== 'number' || !sorted.length) return 0.5
    let lo = 0, hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < l) lo = mid + 1
      else hi = mid
    }
    return lo / sorted.length
  }

  // ---- voice effects (results screen) ---------------------------------------------------

  private fx: Worker | null = null
  private fxId = 0
  private fxRendered = { pitch: 0, tune: 0 }

  private fxWorker(): Worker {
    if (!this.fx) {
      this.fx = new Worker(new URL('../audio/voiceFx.worker.ts', import.meta.url), { type: 'module' })
      this.fx.onmessage = (ev: MessageEvent<FxOut>) => {
        const e = this.engine
        const take = this.lastTake
        if (ev.data.id !== this.fxId || !e || !take || !this.snap.replay) return
        const buf = e.ctx.createBuffer(1, ev.data.samples.length, take.sampleRate)
        buf.copyToChannel(ev.data.samples as Float32Array<ArrayBuffer>, 0)
        e.replaceVoiceBuffer(buf)
        this.set({ voiceFxBusy: false })
      }
    }
    return this.fx
  }

  /** Change an effect: echo / reverb / tone / volume are heard at once; pitch and tune re-render the take. */
  setVoiceFx(patch: Partial<VoiceFx>) {
    const fx = { ...this.snap.voiceFx, ...patch }
    this.set({ voiceFx: fx })
    this.engine?.voiceChain.set(fx)
    this.applyVolumes()
    if (fx.pitch !== this.fxRendered.pitch || fx.tune !== this.fxRendered.tune) this.renderVoiceFx()
  }

  resetVoiceFx() {
    this.setVoiceFx(NO_FX)
  }

  private renderVoiceFx() {
    const take = this.lastTake
    const track = this.snap.track
    const fx = this.snap.voiceFx
    if (!take || !track || !this.snap.replay) return
    this.fxRendered = { pitch: fx.pitch, tune: fx.tune }
    const id = ++this.fxId
    const secs = take.samples.length / take.sampleRate
    const curve = shiftCurve(take.frames, track.notes, {
      start: take.start,
      end: take.start + secs * take.speed,
      pitch: fx.pitch,
      tune: fx.tune,
      keyOffset: this.snap.lastResult?.keyOffset ?? null,
      transpose: this.evalSettings().transpose,
    })
    this.set({ voiceFxBusy: true })
    // one curve value per 10 ms of song time = 10 ms ÷ speed of recording
    this.fxWorker().postMessage({ type: 'render', id, semitones: curve, step: STEP / take.speed } satisfies FxIn, [curve.buffer])
  }

  setReviewAspect(a: ReviewAspect) {
    this.set({ reviewAspect: a })
    this.renderOnce()
  }

  /** Per-note "how wrong" for the results screen (cached; recomputed only when inputs change). */
  private review(): Map<number, NoteReview> | undefined {
    const r = this.snap.lastResult
    const t = this.snap.track
    if (!r || !t || this.snap.session) return undefined
    const st = this.snap.settings
    const key = [r, t, this.snap.reviewAspect, st.toleranceCents, st.scoringMode]
    if (this.reviewCache && this.reviewCache.key.every((k, i) => k === key[i])) return this.reviewCache.map
    const list = reviewNotes(r, t.notes, this.snap.reviewAspect, st.toleranceCents, st.scoringMode === 'exact')
    const map = new Map(list.map((n) => [n.noteIndex, n]))
    this.reviewCache = { key, map }
    return map
  }

  dismissResult() {
    this.leaveReview()
  }
  clearError() {
    this.set({ error: null, micError: null })
  }

  private evalSettings(): EvalSettings {
    const st = this.snap.settings
    return {
      toleranceCents: st.toleranceCents,
      transpose: this.snap.transpose,
      minNoteConfidence: 0.5,
      exactEnabled: st.scoringMode === 'exact',
      weights: st.weights,
    }
  }

  // ---- takes & scoring -------------------------------------------------------

  private startTake(at: number) {
    this.takeFrom = at
    this.frames = []
    this.results.clear()
    this.voicedLevels = []
    this.unvoicedLevels = []
    this.levelBase = null
    this.live.keyOffset = null
    this.recChunks = []
    this.recStart = null
    this.recLen = 0
    // Only a test records and scores; practice just shows your line.
    this.mic.setRecording(this.snap.session)
    const notes = this.snap.track?.notes ?? []
    this.nextScore = notes.findIndex((n) => n.startTime >= at)
    if (this.nextScore < 0) this.nextScore = notes.length
  }

  private endTake() {
    if (this.takeFrom === null) return
    const track = this.snap.track
    const from = this.takeFrom
    const to = this.frames.length ? this.frames[this.frames.length - 1].t : from
    this.takeFrom = null
    this.ghost = this.frames
    this.mic.setRecording(false)
    if (!this.snap.session) return // practice: nothing is scored or kept
    if (track && to - from >= 1 && this.recStart !== null && this.recChunks.length) {
      const len = this.recChunks.reduce((a, c) => a + c.length, 0)
      const samples = new Float32Array(len)
      let o = 0
      for (const c of this.recChunks) {
        samples.set(c, o)
        o += c.length
      }
      this.lastTake = {
        samples, sampleRate: this.mic.sampleRate, start: this.recStart, speed: this.snap.speed, transpose: this.snap.transpose,
        from, to, frames: this.frames,
      }
      this.recChunks = []
      this.set({ canReplay: true })
    }
    if (!track || to - from < 1) return
    const ev = evaluate(track.notes, this.frames, from, to, this.evalSettings(), track.harmony)
    if (ev.notesTotal < 2) return
    const scores = { ...Object.fromEntries(Object.entries(ev.metrics).map(([k, m]) => [k, m.score])), overall: ev.overall.score } as Attempt['scores']
    const attempt: Attempt = {
      id: Date.now().toString(36),
      at: Date.now(),
      phrase: this.snap.loop ? phraseAt(this.snap.phrases, this.snap.loop.start + 1.01) : null,
      scores,
      keyOffset: ev.keyOffset,
    }
    const attempts = [...this.snap.attempts, attempt].slice(-200)
    this.savePrefs({ attempts })
    this.live.lastPass = ev.overall.score ?? ev.metrics.shape.score
    if (this.snap.session) {
      this.sessionEval = ev
      this.set({ attempts })
    } else this.set({ attempts, lastResult: this.engine?.playing ? this.snap.lastResult : ev })
  }

  clearAttempts() {
    this.savePrefs({ attempts: [] })
    this.set({ attempts: [] })
    this.toast('attempt history cleared')
  }

  // ---- frame loop -----------------------------------------------------------

  private startLoop() {
    if (this.raf) return
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      this.frame()
    }
    this.raf = requestAnimationFrame(loop)
    // rAF stops in background tabs; keep looping/scoring alive there.
    this.timer = setInterval(() => document.hidden && this.frame(), 100)
    // While a song is open and visible, tell the analyzer someone is practising (it holds background work).
    this.heartbeat = setInterval(() => {
      if (this.analyzerId && !document.hidden) void analyzer.activity()
    }, 60_000)
  }

  /** Every analysed mic hop (~94/s) arrives here straight from the worker. */
  private onMicReading(r: MicReading) {
    this.live.level = r.level
    this.live.midi = r.midi
    const db = 20 * Math.log10(Math.max(r.level, 1e-6))
    if (r.midi !== null) {
      this.levelEma = this.levelEma === null ? db : this.levelEma * 0.85 + db * 0.15
    } else this.levelEma = null
    const e = this.engine
    if (!e?.playing || this.snap.replay) return
    if (this.takeFrom === null) this.startTake(this.heardTime())
    const t = e.songTimeAtCtx(r.ctxTime) - this.latencySec * e.speed
    const last = this.frames[this.frames.length - 1]
    // Drop readings still in flight from before a seek.
    if (t < this.takeFrom! - 0.25 || (last && t <= last.t)) return
    this.frames.push({ t, midi: r.midi, clarity: r.clarity, level: db })
    const bucket = r.midi !== null ? this.voicedLevels : this.unvoicedLevels
    bucket.push(db)
    if (bucket.length > 600) bucket.splice(0, bucket.length - 600)
  }

  private onMicChunk(samples: Float32Array, endFrame: number) {
    const e = this.engine
    if (!e?.playing || this.snap.replay || this.takeFrom === null) return
    const sr = this.mic.sampleRate
    const songT = e.songTimeAtCtx((endFrame - samples.length) / sr) - this.latencySec * e.speed
    if (this.recStart === null) {
      this.recStart = songT
      this.recLen = 0
    }
    // Keep the recording locked to the song timeline: after a pause/resume (or a
    // dropped chunk) pad with silence or trim overlap so sample N is always song
    // time recStart + N/sr·speed.
    const target = Math.round(((songT - this.recStart) / e.speed) * sr)
    if (target > this.recLen + 256) {
      const gap = Math.min(target - this.recLen, sr * 5)
      this.recChunks.push(new Float32Array(gap))
      this.recLen += gap
    } else if (target < this.recLen - 256) {
      const skip = this.recLen - target
      if (skip >= samples.length) return
      samples = samples.subarray(skip)
    }
    if (this.recLen < Studio.MAX_REC_SEC * sr) {
      this.recChunks.push(samples)
      this.recLen += samples.length
    }
  }

  /** Swap between your voice and the original singer instantly, without pausing. */
  setListenSource(src: 'me' | 'original') {
    if (!this.snap.replay || src === this.snap.listenSource) return
    if (src === 'original' && !this.snap.caps?.hasGuide) return
    const v = this.snap.viewing
    if (src === 'me' && v && !v.hasVoice) {
      this.toast(`${v.name} kept their voice private`) // a take from today's top, shared without the voice
      return
    }
    this.set({ listenSource: src })
    this.applyVolumes()
  }

  toggleListenSource() {
    this.setListenSource(this.snap.listenSource === 'me' ? 'original' : 'me')
  }

  exitReplay() {
    if (!this.snap.replay) return
    this.engine?.setVoice(null)
    this.set({ replay: false })
    this.applyVolumes()
  }

  private renderOnce() {
    this.viewDirty = true
    requestAnimationFrame(() => this.renderer?.draw(this.view()))
  }

  /**
   * The key offset the graph uses, gliding to the estimate (~⅓ s) instead of
   * jumping: when it first appears or changes, your line slides into place.
   */
  private shownKeyOffset: number | null = null
  private lastGlide = 0

  // ---- voice coach: during a test, say what's wrong with what the mic hears ---------

  private coach = new CoachState()
  private lastCoach = 0

  private coachVoice(now: number) {
    const t = performance.now()
    if (t - this.lastCoach < 500) return
    this.lastCoach = t
    const testing = this.snap.session && !!this.engine?.playing && this.mic.active && !this.snap.replay
    let shown: VoiceIssue | null = null
    if (testing && this.snap.track) {
      const issue = this.snap.muted
        ? 'muted'
        : voiceIssue({ frames: this.frames, notes: this.snap.track.notes, now, floorDb: this.unvoicedLevels.length >= 20 ? this.levelFloor : null })
      shown = this.coach.update(issue, t / 1000)
    } else this.coach.reset()
    if (shown !== this.snap.voiceIssue) this.set({ voiceIssue: shown })
  }

  private glideKeyOffset() {
    const target = this.live.keyOffset
    const t = performance.now()
    const dt = Math.min(0.1, (t - (this.lastGlide || t)) / 1000)
    this.lastGlide = t
    if (target === null) {
      this.shownKeyOffset = null
      return
    }
    const from = this.shownKeyOffset ?? 0 // before the first estimate the line was drawn as sung
    const next = from + (target - from) * (1 - Math.exp(-dt / 0.12))
    this.shownKeyOffset = Math.abs(target - next) < 0.01 ? target : next
  }

  private frame() {
    const e = this.engine
    const track = this.snap.track
    e?.tick()
    this.glideKeyOffset()
    const now = this.heardTime()
    const transpose = this.snap.transpose
    this.coachVoice(now)

    let userMidi = this.mic.active ? this.live.midi : null
    if (this.snap.replay && this.lastTake) {
      const fr = this.lastTake.frames
      let lo = 0, hi = fr.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (fr[mid].t < now) lo = mid + 1
        else hi = mid
      }
      userMidi = fr[lo] && fr[lo].t - now < 0.05 ? fr[lo].midi : null
      this.live.midi = userMidi
    }
    if (!this.mic.active && !this.snap.replay) {
      this.live.midi = null
      this.live.level = 0
    }

    // Live guidance against the note under the playhead
    const exact = this.snap.settings.scoringMode === 'exact'
    let target: number | null = null
    let refRel: number | null = null
    if (track) {
      const i = noteAt(track.notes, now)
      if (i >= 0 && track.notes[i].sung && track.notes[i].confidence >= 0.5) {
        target = track.notes[i].midiPitch + transpose
        const l = track.notes[i].loudness
        refRel = l === undefined ? null : l - this.refLoudMedian
      }
    }
    this.updateLevelStats()
    const levelReliable = this.levelBase !== null && this.voicedLevels.length >= 60 && this.levelBase - this.levelFloor >= 10
    const g = liveGuidance({
      userMidi,
      targetMidi: target,
      keyOffset: this.live.keyOffset,
      exact,
      tolerance: this.snap.settings.toleranceCents,
      prevPitch: this.live.guidance.pitch,
      userLevelRel: this.levelEma !== null && this.levelBase !== null ? this.levelEma - this.levelBase : null,
      refLevelRel: refRel,
      levelReliable,
    })
    this.live.guidance = this.mic.active || this.snap.replay ? { ...g, dynamics: this.snap.replay ? null : g.dynamics } : { pitch: null, cents: null, dynamics: null }
    this.live.exact = exact
    if (!this.mic.active && !this.snap.replay) this.live.state = 'idle'
    else if (userMidi === null) this.live.state = 'no-voice'
    else if (target === null) this.live.state = 'listening'
    else if (g.pitch === null) this.live.state = 'octave'
    else this.live.state = g.pitch === 'on' ? 'on-pitch' : g.pitch === 'lower' ? 'sharp' : 'flat'
    this.live.cents = this.mic.active ? g.cents : null
    // Harmony clash, only when the chord data is reliable and the clash is sustained.
    const chord = track && userMidi !== null && target !== null ? chordAt(track.harmony, now) : null
    this.clashFrames = chord && clashesWith(userMidi!, target!, chord) ? this.clashFrames + 1 : 0
    this.live.clash = this.clashFrames >= 15
    this.live.target = target
    this.live.time = now
    this.live.duration = e?.duration ?? 0

    // Re-evaluate the recent past whenever a note finishes (current take only):
    // colours finished notes, refreshes the singer's key offset and onsets.
    if (track && this.takeFrom !== null) {
      let finished = false
      while (this.nextScore < track.notes.length && track.notes[this.nextScore].endTime < now - 0.05) {
        this.nextScore++
        finished = true
      }
      if (finished && performance.now() - this.lastLiveEval > 120) {
        this.lastLiveEval = performance.now()
        this.liveEvaluate(track, now, exact)
      }
    }

    // Lyrics / phrase position — only touches React when it changes
    if (track) {
      const li = lyricLineAt(this.snap.lyrics, now)
      let wi = -1
      const words = li >= 0 ? this.snap.lyrics[li].words : undefined
      if (words) for (let k = 0; k < words.length; k++) if (words[k].start <= now + 0.05) wi = k
      const ph = phraseAt(this.snap.phrases, now)
      if (li !== this.snap.lyricPos.line || wi !== this.snap.lyricPos.word || ph !== this.snap.phrase) {
        this.set({ lyricPos: { line: li, word: wi }, phrase: ph })
      }
    }

    // Paused with nothing changing: skip the redraw (saves the CPU / GPU a full canvas paint every frame).
    const v = this.view()
    const sizes = `${v.frames.length}|${v.ghost.length}|${v.results.size}`
    if (this.renderer && (this.renderer.stale || this.viewDirty || sizes !== this.lastSizes || viewChanged(this.lastView, v))) {
      this.renderer.draw(v)
      this.lastView = v
      this.lastSizes = sizes
      this.viewDirty = false
    }

    const ts = performance.now()
    if (ts - this.lastLiveEmit > 50) {
      this.lastLiveEmit = ts
      this.live.label = this.mic.active ? '' : 'mic off'
      this.liveListeners.forEach((l) => l(this.live))
    }
  }

  /** Two 400-value sorts: run them a few times a second, not every frame. */
  private updateLevelStats() {
    const t = performance.now()
    if (t - this.lastLevelStats < 250) return
    this.lastLevelStats = t
    if (this.voicedLevels.length >= 20) this.levelBase = median(this.voicedLevels.slice(-400))
    if (this.unvoicedLevels.length >= 20) {
      const u = [...this.unvoicedLevels.slice(-400)].sort((a, b) => a - b)
      this.levelFloor = u[Math.floor(u.length * 0.2)]
    }
  }

  private liveEvaluate(track: ReferenceTrack, now: number, exact: boolean) {
    const from = Math.max(this.takeFrom!, now - 30)
    const ev = evaluate(track.notes, this.frames, from, now, this.evalSettings(), track.harmony)
    if (ev.keyOffset !== null) this.live.keyOffset = ev.keyOffset
    const tol = this.snap.settings.toleranceCents
    for (const n of ev.notes) {
      const c = exact ? n.absCents : n.relCents
      let status: NoteResult['status'] = 'missed'
      if (n.sung && c !== null) {
        if (exact && Math.abs(c) > 600) status = 'octave'
        else status = Math.abs(c) <= tol ? 'hit' : c > 0 ? 'sharp' : 'flat'
      } else if (n.coverage >= 0.25) continue // partly sung: leave uncoloured rather than guess
      this.results.set(n.noteIndex, {
        noteIndex: n.noteIndex,
        status,
        cents: c,
        coverage: n.coverage,
        onPitchRatio: 0,
        onsetDelta: n.onsetMs === null ? null : n.onsetMs / 1000,
      })
    }
  }

  private view(): GraphView {
    const s = this.snap.settings
    const t = this.snap.track
    return {
      time: this.heardTime(),
      duration: this.engine?.duration ?? 0,
      notes: t?.notes ?? [],
      transpose: this.snap.transpose,
      contour: t?.contour,
      voiceSpans: t?.voiceSpans,
      focus: this.snap.focus,
      review: this.review(),
      frames: this.snap.replay && this.lastTake ? this.lastTake.frames : this.frames,
      ghost: this.snap.replay ? [] : this.ghost,
      results: this.results,
      breaths: s.showBreaths ? this.snap.breaths : [],
      loop: this.snap.loop,
      tempo: t?.tempo,
      firstBeat: t?.firstBeat,
      beatsPerBar: t?.beatsPerBar ?? 4,
      pxPerSec: s.pxPerSec,
      semitoneSpan: s.semitoneSpan,
      showGrid: s.showGrid,
      showNoteNames: s.showNoteNames,
      melodyView: s.melodyView,
      lineDetail: s.lineDetail,
      tolerance: s.toleranceCents,
      live: { midi: this.live.midi, target: this.live.target, state: this.live.state, cents: this.live.cents },
      layers: s.layers,
      exact: s.scoringMode === 'exact',
      keyOffset: this.shownKeyOffset,
      phrases: this.snap.phrases,
      refLoudness: t?.loudness,
      refLoudMedian: this.refLoudMedian,
      levelBase: this.levelBase,
    }
  }

  noteName(midi: number | null) {
    return midi === null ? '—' : midiToNoteName(midi)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    clearInterval(this.timer)
    clearInterval(this.heartbeat)
    this.raf = 0
    this.mic.stop()
    this.engine?.dispose()
    this.engine = null
  }
}

export const studio = new Studio()
if (import.meta.env.DEV) (window as unknown as { lemo: Studio }).lemo = studio

/** Did anything the graph draws change? (fields compared by identity) */
function viewChanged(a: GraphView | null, b: GraphView): boolean {
  if (!a) return true
  for (const k of Object.keys(b) as (keyof GraphView)[]) {
    if (a[k] === b[k]) continue
    if (k === 'live') {
      const x = a.live, y = b.live
      if (x.midi !== y.midi || x.target !== y.target || x.state !== y.state || x.cents !== y.cents) return true
      continue
    }
    return true
  }
  return false
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(1)

/** Read a response body while reporting how much has arrived. */
async function readWithProgress(res: Response, onProgress: (got: number, total: number) => void): Promise<Blob> {
  const total = Number(res.headers.get('content-length')) || 0
  const type = res.headers.get('content-type') ?? ''
  if (!res.body) return res.blob()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    onProgress(got, total)
  }
  return new Blob(chunks as BlobPart[], { type })
}

/**
 * Which song automatically found lyrics belong to, and how they were picked; they're
 * looked up again if this changes. v2: checked against the singing; v3: + YouTube's own captions.
 */
function lyricsKey(t: { title: string; artist?: string | null }): string {
  return `v3 · ${t.title} · ${t.artist ?? ''}`
}
