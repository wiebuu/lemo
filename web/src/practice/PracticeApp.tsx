// The singing course, as its own full-screen app over Lemody:
// course map → (find your voice) → a lesson in stages → results.
// Phones first: compact type, small controls, the actions in a bar under the thumb.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, AudioWaveform, Check, ChevronLeft, ChevronRight, Lock, Mic, MicVocal, PencilLine, RotateCcw, SkipForward, Star, Volume2 } from 'lucide-react'
import { Wordmark } from '../components/Brand'
import { cx } from '../components/ui'
import { go, navigate } from '../pages/router'
import { SiteFooter } from '../pages/Footer'
import { studio } from '../state/studio'
import { median, midiToNoteName } from '../lib/music'
import {
  LESSONS, NOTATIONS, SCALE, STEPS, homeName, introText, label, lessonNotes, lessonSteps, lessonTitle, parseLine,
  starsFor, toSemis, writeLine, type Notation, type StepKind,
} from './course'
import { IN_TUNE, Trainer, VoiceIO, loadProgress, saveProgress, type MicIssue, type Progress } from './trainer'

type Screen = { k: 'home' } | { k: 'voice'; then?: number } | { k: 'lesson'; i: number } | { k: 'free' }

/** Two parts to the course: the scale, one note at a time; then moving around it. */
const UNITS = [
  { title: 'The scale, note by note', from: 0, to: 8 },
  { title: 'Moving around', from: 8, to: LESSONS.length },
]

/** Redraws at screen rate while on (the trainer changes ~94×/s; React just shows a copy). */
function useFrames(on: boolean) {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!on) return
    let raf = 0
    const loop = () => {
      redraw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [on])
  return redraw
}

const unlocked = (p: Progress, i: number) => i === 0 || !!p.best[LESSONS[i - 1].id]

export default function PracticeApp() {
  const [p, setP] = useState(loadProgress)
  const update = useCallback((patch: Partial<Progress>) => {
    setP((old) => {
      const next = { ...old, ...patch }
      saveProgress(next)
      return next
    })
  }, [])
  const voice = useMemo(() => new VoiceIO(), [])
  const [screen, setScreen] = useState<Screen>({ k: 'home' })
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.title = 'Singing course · learn to sing in tune · Lemody'
    // the studio underneath: its song and mic would get in the way
    if (studio.snap.playing) void studio.togglePlay()
    if (studio.snap.mic !== 'off') void studio.toggleMic()
    return () => voice.close()
  }, [voice])

  // only the lesson and voice screens listen
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
    if (screen.k === 'home') voice.stop()
  }, [screen, voice])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.target instanceof HTMLInputElement) return e.target.blur()
      e.preventDefault()
      if (screen.k === 'home') navigate('/')
      else setScreen({ k: 'home' })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [screen])

  const openLesson = (i: number) => setScreen(p.voiceSet ? { k: 'lesson', i } : { k: 'voice', then: i })
  const screenKey = screen.k === 'lesson' ? `lesson${screen.i}` : screen.k

  return (
    <div ref={scroller} className="fixed inset-0 z-[70] bg-bg overflow-y-auto overscroll-contain select-none">
      {/* exactly the studio's header: same height, same place — it never moves */}
      <div className="sticky top-0 z-20 bg-bg/85 backdrop-blur-md">
        <header className="max-w-3xl mx-auto px-4 sm:px-8 flex items-center gap-2 sm:gap-4 pt-[max(0.75rem,calc(env(safe-area-inset-top)-0.5rem))] pb-1.5 sm:pt-[max(1.25rem,calc(env(safe-area-inset-top)-0.5rem))] sm:pb-3">
          <button type="button" onClick={() => navigate('/')} className="shrink-0" aria-label="Lemody home"><Wordmark /></button>
          <span className="flex-1" />
          <button type="button" onClick={() => setScreen({ k: 'voice' })} title="Your home note — tap to change"
            className="h-[29px] flex items-center gap-1.5 rounded-full border border-line px-2.5 text-[11px] text-sub hover:text-text transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-main" />
            <span className="font-mono text-text">{homeName(p.notation, p.home)}</span>
            {p.notation !== 'letters' && <span className="font-mono">{midiToNoteName(p.home)}</span>}
          </button>
          <a href="/" onClick={go} className="h-[29px] flex items-center gap-1.5 text-xs text-sub hover:text-text rounded-full surface px-3">
            <ArrowLeft size={13} /> <span className="hidden sm:inline">back to singing</span><span className="sm:hidden">back</span>
          </a>
        </header>
      </div>

      <main key={screenKey} className="screen-in max-w-3xl mx-auto px-4 sm:px-8 pt-3 sm:pt-8 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        {screen.k === 'home' && <CourseMap p={p} update={update} open={openLesson} free={() => setScreen({ k: 'free' })} voice={() => setScreen({ k: 'voice' })} />}
        {screen.k === 'voice' && (
          <VoiceSetup voice={voice} p={p} back={() => setScreen({ k: 'home' })}
            done={(home) => {
              update({ home, voiceSet: true })
              setScreen(screen.then !== undefined ? { k: 'lesson', i: screen.then } : { k: 'home' })
            }} />
        )}
        {screen.k === 'lesson' && (
          <LessonRun i={screen.i} voice={voice} p={p} update={update}
            home={() => setScreen({ k: 'home' })}
            next={() => setScreen(screen.i + 1 < LESSONS.length ? { k: 'lesson', i: screen.i + 1 } : { k: 'home' })} />
        )}
        {screen.k === 'free' && <FreePractice voice={voice} p={p} update={update} back={() => setScreen({ k: 'home' })} />}
      </main>
    </div>
  )
}

// =================================================================== course map

function CourseMap({ p, update, open, free, voice }: { p: Progress; update: (x: Partial<Progress>) => void; open: (i: number) => void; free: () => void; voice: () => void }) {
  const done = LESSONS.filter((l) => p.best[l.id]).length
  const stars = LESSONS.reduce((a, l) => a + (p.best[l.id]?.stars ?? 0), 0)
  const firstOpen = LESSONS.findIndex((l) => !p.best[l.id])
  const next = firstOpen >= 0 ? firstOpen : LESSONS.length - 1
  const l = LESSONS[next]
  return (
    <div>
      {/* the start screen's staff and sung line, so the course feels like part of Lemody */}
      <svg viewBox="0 0 640 46" className="w-full h-5 mb-3 sm:h-7 sm:mb-4" aria-hidden preserveAspectRatio="none">
        {[0, 1, 2, 3, 4].map((k) => (
          <line key={k} x1="0" x2="640" y1={5 + k * 9} y2={5 + k * 9} stroke="var(--text)" strokeOpacity=".07" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d="M0 41 L80 41 L80 32 L160 32 L160 23 L240 23 L240 18.5 L320 18.5 L320 9.5 L400 9.5 L400 5 L640 5"
          fill="none" stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d="M0 38 C50 38 60 30 100 31 S170 22 210 23 S280 16 320 18 S370 8 410 9.5 S520 5 640 5"
          fill="none" stroke="var(--main)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <Eyebrow>Singing course</Eyebrow>
      <div className="mt-1 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6">
        <div>
          <h1 className="text-[26px] sm:text-[36px] font-semibold tracking-[-0.035em] leading-[1.05] text-text">Learn to <span className="text-main">sing</span> in tune</h1>
          <p className="mt-1 text-[13px] text-sub">Hear a note, sing it, hold it. One new note each lesson.</p>
        </div>
        <NotationSwitch value={p.notation} onChange={(notation) => update({ notation })} />
      </div>

      {/* up next */}
      {!p.voiceSet ? (
        <UpNext kicker="Start here" title="Find your voice" text="Sing one easy note — the course sets itself to your range."
          glyph={<span className="w-11 h-11 rounded-xl bg-main/10 text-main flex items-center justify-center shrink-0"><Mic size={17} /></span>} onClick={voice} />
      ) : (
        <UpNext kicker={done === LESSONS.length ? 'Course complete · aim for ★★★' : `Lesson ${next + 1} · ${done ? 'up next' : 'start here'}`}
          title={lessonTitle(l, p.notation, p.home)} text={l.about}
          glyph={<span className="w-11 h-11 rounded-xl bg-main/10 flex items-end justify-center pb-2.5 shrink-0"><StepGlyph notes={lessonNotes(l)} lit={l.adds !== undefined ? SCALE[l.adds] : undefined} size="md" /></span>}
          onClick={() => open(next)} />
      )}
      <div className="mt-3 flex items-center gap-3 text-[11px] text-sub tabular-nums">
        <div className="flex-1 h-[3px] rounded-full bg-line overflow-hidden">
          <div className="h-full bg-main rounded-full transition-[width] duration-700" style={{ width: `${(done / LESSONS.length) * 100}%` }} />
        </div>
        <span>{done}/{LESSONS.length} lessons</span>
        <span className="flex items-center gap-1"><Star size={10} className="fill-current text-main" />{stars}</span>
      </div>

      {UNITS.map((u, ui) => {
        const unitDone = LESSONS.slice(u.from, u.to).filter((x) => p.best[x.id]).length
        return (
          <section key={u.title} className="mt-8">
            <div className="flex items-baseline justify-between mb-2 px-1">
              <Eyebrow>Unit {ui + 1} · {u.title}</Eyebrow>
              <span className="text-[11px] text-sub tabular-nums">{unitDone}/{u.to - u.from}</span>
            </div>
            <div className="rounded-2xl border border-line divide-y divide-line overflow-hidden">
              {LESSONS.slice(u.from, u.to).map((les, k) => {
                const i = u.from + k
                return <LessonRow key={les.id} n={i + 1} p={p} lesson={les} open={unlocked(p, i)} current={p.voiceSet && i === next && firstOpen >= 0} onClick={() => open(i)} />
              })}
            </div>
          </section>
        )
      })}

      <section className="mt-8">
        <div className="mb-2 px-1"><Eyebrow>Practice anything</Eyebrow></div>
        <div className="rounded-2xl border border-line divide-y divide-line overflow-hidden">
          <Row icon={<PencilLine size={14} />} title="Free practice" text="Write your own line of notes and sing it" onClick={free} />
          <Row icon={<Mic size={14} />} title="Find your voice" text={`Home note ${homeName(p.notation, p.home)} · ${midiToNoteName(p.home)} — sing to set it again`} onClick={voice} />
        </div>
      </section>

      <SiteFooter className="mt-12 pt-6 border-t border-line" />
    </div>
  )
}

function Eyebrow({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <div className={cx('text-[10.5px] font-medium uppercase tracking-[0.16em]', accent ? 'text-main' : 'text-sub')}>{children}</div>
}

function NotationSwitch({ value, onChange }: { value: Notation; onChange: (n: Notation) => void }) {
  return (
    <div className="grid grid-cols-4 sm:inline-grid rounded-lg bg-sub-alt p-0.5 text-[11.5px] shrink-0" role="radiogroup" aria-label="How notes are written">
      {NOTATIONS.map((n) => (
        <button key={n.id} type="button" role="radio" aria-checked={value === n.id} title={n.tip} onClick={() => onChange(n.id)}
          className={cx('h-7 rounded-md px-3 font-mono whitespace-nowrap transition-all', value === n.id ? 'bg-bg text-text shadow-[0_1px_2px_rgba(0,0,0,.4)]' : 'text-sub hover:text-text')}>
          {n.label}
        </button>
      ))}
    </div>
  )
}

/** The one thing to do next: a slim strip with a soft glow of the accent. */
function UpNext({ kicker, title, text, glyph, onClick }: { kicker: string; title: string; text: string; glyph: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="group mt-5 w-full text-left relative overflow-hidden rounded-2xl border border-line p-3.5 sm:p-4 flex items-center gap-3.5 transition-colors hover:border-main/40 active:scale-[.995]"
      style={{ background: 'radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--main) 9%, transparent), transparent 60%), var(--sub-alt)' }}>
      {glyph}
      <span className="flex-1 min-w-0">
        <span className="block text-[10.5px] font-medium uppercase tracking-[0.14em] text-main">{kicker}</span>
        <span className="block mt-0.5 text-[15px] sm:text-base font-semibold tracking-tight text-text truncate">{title}</span>
        <span className="block text-[12px] text-sub truncate">{text}</span>
      </span>
      <span className="w-9 h-9 rounded-full bg-main text-bg flex items-center justify-center shrink-0 transition-transform group-hover:translate-x-0.5">
        <ArrowRight size={16} />
      </span>
    </button>
  )
}

function LessonRow({ n, p, lesson, open, current, onClick }: { n: number; p: Progress; lesson: (typeof LESSONS)[number]; open: boolean; current: boolean; onClick: () => void }) {
  const best = p.best[lesson.id]
  return (
    <button type="button" disabled={!open} onClick={onClick}
      className={cx('relative w-full text-left flex items-center gap-3 px-3.5 sm:px-4 py-3 transition-colors',
        open ? 'hover:bg-sub-alt active:bg-sub-alt' : 'cursor-default', current && 'bg-sub-alt/60')}>
      {current && <span className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full bg-main" />}
      <span className={cx('w-5 text-[11px] font-mono tabular-nums shrink-0', best ? 'text-main' : open ? 'text-sub' : 'text-sub/40')}>{String(n).padStart(2, '0')}</span>
      <span className="flex-1 min-w-0">
        <span className={cx('flex items-center gap-2 text-[13.5px] font-medium', open ? 'text-text' : 'text-sub/50')}>
          <span className="truncate">{lessonTitle(lesson, p.notation, p.home)}</span>
          {current && <span className="shrink-0 text-[9.5px] font-medium uppercase tracking-[0.12em] text-main">next</span>}
        </span>
        <span className={cx('block text-[11.5px] truncate', open ? 'text-sub' : 'text-sub/40')}>{lesson.about}</span>
      </span>
      <span className={cx('shrink-0', !open && 'opacity-40')}><StepGlyph notes={lessonNotes(lesson)} lit={lesson.adds !== undefined ? SCALE[lesson.adds] : undefined} /></span>
      <span className="w-11 flex justify-end shrink-0">
        {!open ? <Lock size={12} className="text-sub/40" /> : best ? <Stars n={best.stars} size={9} /> : <ChevronRight size={15} className="text-sub" />}
      </span>
    </button>
  )
}

function Row({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left flex items-center gap-3 px-3.5 sm:px-4 py-3 hover:bg-sub-alt active:bg-sub-alt transition-colors">
      <span className="w-7 h-7 rounded-lg bg-sub-alt flex items-center justify-center text-main shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13.5px] font-medium text-text">{title}</span>
        <span className="block text-[11.5px] text-sub truncate">{text}</span>
      </span>
      <ChevronRight size={15} className="text-sub shrink-0" />
    </button>
  )
}

/** The scale as eight tiny rising bars: the lesson's notes show, the new one is lit. */
function StepGlyph({ notes, lit, size = 'sm' }: { notes: number[]; lit?: number; size?: 'sm' | 'md' }) {
  const unit = size === 'md' ? 3.8 : 2.9
  return (
    <span className="flex items-end gap-[2px]" aria-hidden>
      {SCALE.map((s, k) => (
        <span key={s} className={cx('rounded-[1px]', size === 'md' ? 'w-[3px]' : 'w-[2.5px]',
          s === lit ? 'bg-main' : notes.includes(s) ? 'bg-sub/70' : 'bg-line')}
          style={{ height: 4 + k * unit * (size === 'md' ? 0.75 : 0.7) }} />
      ))}
    </span>
  )
}

/** A note's name, with the dot above (higher octave) or below (lower) as written. */
function NoteText({ s, p }: { s: number; p: Pick<Progress, 'notation' | 'home'> }) {
  const l = label(s, p.notation, p.home)
  return (
    <span className="relative inline-block">
      {l.text}
      {l.oct !== 0 && <span className={cx('absolute left-1/2 -translate-x-1/2 w-[0.18em] h-[0.18em] min-w-[3px] min-h-[3px] rounded-full bg-current', l.oct > 0 ? '-top-[0.15em]' : '-bottom-[0.2em]')} />}
    </span>
  )
}

// =================================================================== find your voice

function VoiceSetup({ voice, p, done, back }: { voice: VoiceIO; p: Progress; done: (home: number) => void; back: () => void }) {
  const [mic, setMic] = useState<'starting' | 'on' | string>('starting')
  const [found, setFound] = useState<number | null>(p.voiceSet ? p.home : null)
  const [listening, setListening] = useState(!p.voiceSet)
  const sung = useRef<{ midi: number | null; heard: number[]; held: number }>({ midi: null, heard: [], held: 0 })
  const redraw = useFrames(listening && mic === 'on')

  const listen = useCallback(async () => {
    setMic('starting')
    try {
      await voice.start()
      setMic('on')
    } catch (e) {
      setMic((e as Error).message)
    }
  }, [voice])

  useEffect(() => {
    void listen()
  }, [listen])

  useEffect(() => {
    let last = 0
    voice.onReading = (r, quiet) => {
      const s = sung.current
      const now = performance.now() / 1000
      const dt = last ? Math.min(0.1, now - last) : 0
      last = now
      if (!listening || quiet) return
      s.midi = r.midi
      if (r.midi === null) {
        s.held = Math.max(0, s.held - dt)
        return
      }
      // a steady note: within a semitone of what's been heard so far
      const mid = s.heard.length ? median(s.heard.slice(-40)) : r.midi
      if (Math.abs(r.midi - mid) > 1) {
        s.heard = [r.midi]
        s.held = 0
        return
      }
      s.heard.push(r.midi)
      s.held += dt
      if (s.held >= 2) {
        // home sits a little under the easy note, so the scale above it stays comfortable
        const home = Math.max(40, Math.min(64, Math.round(median(s.heard)) - 3))
        setFound(home)
        setListening(false)
        voice.play(home)
      }
    }
    return () => {
      voice.onReading = null
    }
  }, [voice, listening])

  const again = () => {
    sung.current = { midi: null, heard: [], held: 0 }
    setFound(null)
    setListening(true)
    redraw()
  }
  const set = (h: number) => {
    setFound(h)
    setListening(false)
    voice.play(h)
  }

  const s = sung.current
  return (
    <div>
      <BackLink onClick={back}>Course</BackLink>
      <div className="mt-6 sm:mt-10 max-w-sm mx-auto text-center">
        <Eyebrow accent>Find your voice</Eyebrow>
        {listening ? (
          <>
            <h1 className="mt-1.5 text-[22px] sm:text-2xl font-semibold tracking-tight text-text">Sing an easy “aah”</h1>
            <p className="mt-1.5 text-[13px] text-sub">The note you’d hum without thinking. Hold it for two seconds.</p>
            <div className="mt-8 flex justify-center">
              <Ring progress={Math.min(1, s.held / 2)} size={132}>
                <span className="text-2xl font-semibold text-text font-mono">{s.midi !== null ? midiToNoteName(s.midi) : '—'}</span>
                <span className="text-[11px] text-sub mt-0.5">{mic === 'on' ? (s.midi === null ? 'listening' : 'hold it') : mic === 'starting' ? 'starting mic' : ''}</span>
              </Ring>
            </div>
            {mic !== 'on' && mic !== 'starting' && <MicProblem message={mic} retry={() => void listen()} />}
            <p className="mt-10 text-[12px] text-sub">
              Can’t sing right now? Pick a voice:{' '}
              <button type="button" onClick={() => set(48)} className="text-text underline underline-offset-4 decoration-line hover:decoration-main">lower</button>
              {' · '}
              <button type="button" onClick={() => set(57)} className="text-text underline underline-offset-4 decoration-line hover:decoration-main">higher</button>
            </p>
          </>
        ) : found !== null && (
          <>
            <h1 className="mt-1.5 text-[22px] sm:text-2xl font-semibold tracking-tight text-text">Your home note</h1>
            <p className="mt-1.5 text-[13px] text-sub">Every lesson climbs from here. If the top of the scale strains, go lower.</p>
            <div className="mt-8 flex items-center justify-center gap-5">
              <RoundBtn label="lower" onClick={() => set(Math.max(40, found - 1))}>−</RoundBtn>
              <button type="button" onClick={() => voice.play(found)}
                className="w-28 h-28 rounded-full border border-line flex flex-col items-center justify-center hover:border-main/60 transition-colors"
                style={{ background: 'radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--main) 10%, transparent), var(--sub-alt) 70%)' }}>
                <span className="text-3xl font-semibold text-text tracking-tight">{homeName(p.notation, found)}</span>
                <span className="text-[11px] text-sub font-mono mt-0.5">{midiToNoteName(found)}</span>
                <Volume2 size={12} className="text-main mt-1.5" />
              </button>
              <RoundBtn label="higher" onClick={() => set(Math.min(64, found + 1))}>+</RoundBtn>
            </div>
            <button type="button" onClick={() => voice.playLine(SCALE.map((x) => found + x))} className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-sub hover:text-text">
              <Volume2 size={12} /> hear the scale it makes
            </button>
            <div className="mt-8 flex justify-center gap-2">
              <Btn onClick={again}><RotateCcw size={13} /> Sing again</Btn>
              <Btn primary onClick={() => done(found)}>Sounds right <ArrowRight size={14} /></Btn>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// =================================================================== a lesson

interface StepResult { acc: number; find: number; stars: number; hints: number; skipped: number; seconds: number }

function LessonRun({ i, voice, p, update, home, next }: { i: number; voice: VoiceIO; p: Progress; update: (x: Partial<Progress>) => void; home: () => void; next: () => void }) {
  const lesson = LESSONS[i]
  const steps = useMemo(() => lessonSteps(lesson), [lesson])
  const trainer = useMemo(() => new Trainer(), [])
  const [stepI, setStepI] = useState(0)
  const [phase, setPhase] = useState<'run' | 'done' | 'finished'>('run')
  const [results, setResults] = useState<(StepResult | undefined)[]>([])
  const [mic, setMic] = useState<'starting' | 'on' | string>('starting')
  const step = steps[stepI]
  const known = lessonNotes(lesson)

  useFrames(phase === 'run' && mic === 'on')

  const startMic = useCallback(async () => {
    setMic('starting')
    try {
      await voice.start()
      setMic('on')
    } catch (e) {
      setMic((e as Error).message)
    }
  }, [voice])
  useEffect(() => {
    void startMic()
  }, [startMic])

  // each stage: load its line; play the first note (or, in the test, only the home note)
  useEffect(() => {
    trainer.load(step.notes)
    setPhase('run')
    if (mic !== 'on') return
    const t = setTimeout(() => voice.play(p.home + (step.kind === 'test' ? 0 : step.notes[0])), 350)
    return () => clearTimeout(t)
  }, [stepI, mic, step, trainer, voice, p.home])

  const finishStep = useCallback(() => {
    const t = trainer
    const r: StepResult = { acc: t.accuracy, find: t.findTime, stars: Math.max(1, starsFor(t.accuracy, t.findTime) - (t.hints > 2 ? 1 : 0)), hints: t.hints, skipped: t.skipped, seconds: t.seconds }
    setResults((old) => {
      const n = [...old]
      n[stepI] = r
      return n
    })
    if (step.kind === 'test') {
      const best = p.best[lesson.id]
      if (!best || r.stars > best.stars || (r.stars === best.stars && r.acc > best.acc)) update({ best: { ...p.best, [lesson.id]: { acc: r.acc, stars: r.stars } } })
      setPhase('finished')
    } else setPhase('done')
  }, [trainer, stepI, step, p.best, lesson.id, update])

  useEffect(() => {
    voice.onReading = (r, quiet) => {
      if (phase !== 'run') return
      if (!trainer.push(r, p.home, lesson.hold, quiet)) return
      if (trainer.done) finishStep()
      else if (STEPS[step.kind].autoplay) voice.play(p.home + trainer.current!)
    }
    return () => {
      voice.onReading = null
    }
  }, [voice, trainer, phase, p.home, lesson.hold, step, finishStep])

  const hint = useCallback(() => {
    if (phase !== 'run' || trainer.current === undefined) return
    if (step.kind === 'practice' || step.kind === 'test') trainer.hints++
    voice.play(p.home + (step.kind === 'test' ? 0 : trainer.current))
  }, [phase, step, trainer, voice, p.home])
  const skip = useCallback(() => {
    if (phase !== 'run') return
    if (trainer.skip()) finishStep()
    else if (STEPS[step.kind].autoplay) voice.play(p.home + trainer.current!)
  }, [phase, trainer, finishStep, step, voice, p.home])
  // a stage's card → the next stage (once, however fast Enter is pressed)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const advance = useCallback(() => {
    if (phaseRef.current !== 'done') return
    phaseRef.current = 'run'
    setPhase('run')
    setStepI((s) => Math.min(steps.length - 1, s + 1))
  }, [steps.length])
  const redo = useCallback(() => {
    trainer.load(step.notes)
    setPhase('run')
    voice.play(p.home + (step.kind === 'test' ? 0 : step.notes[0]))
  }, [trainer, step, voice, p.home])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault()
        hint()
      } else if (e.key === 'Enter' && phase === 'done') advance()
      else if (e.key === 'Enter' && phase === 'finished') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hint, advance, next, phase])

  const title = lessonTitle(lesson, p.notation, p.home)

  if (phase === 'finished' && results[stepI]) {
    return <LessonDone n={i + 1} title={title} steps={steps} results={results} trainer={trainer} p={p} best={p.best[lesson.id]}
      again={redo} next={i + 1 < LESSONS.length ? next : undefined} home={home} r={results[stepI]!} />
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <BackLink onClick={home}>Lessons</BackLink>
        <span className="text-[11px] text-sub truncate"><span className="font-mono">{String(i + 1).padStart(2, '0')}</span> · {title}</span>
      </div>

      {/* the stages, as a segmented track */}
      <div className="mt-4 grid grid-cols-4 gap-1.5">
        {steps.map((s, k) => {
          const r = results[k]
          const now = k === stepI && phase === 'run'
          return (
            <div key={s.kind} className="min-w-0">
              <div className="h-[3px] rounded-full bg-line overflow-hidden">
                <div className="h-full rounded-full bg-main transition-[width] duration-300"
                  style={{ width: r ? '100%' : now ? `${(trainer.idx / Math.max(1, trainer.notes.length)) * 100}%` : '0%' }} />
              </div>
              <div className={cx('mt-1.5 text-[10.5px] truncate flex items-center gap-1', k === stepI ? 'text-text font-medium' : r ? 'text-sub' : 'text-sub/50')}>
                {r && <Check size={10} className="text-main shrink-0" strokeWidth={3} />}
                {STEPS[s.kind].name}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-[13px] leading-snug text-sub min-h-[2.5em]">{step.kind === 'intro' ? introText(lesson, p.notation, p.home) : STEPS[step.kind].how}</p>

      {phase === 'done' && results[stepI] ? (
        <StepDone kind={step.kind} r={results[stepI]!} again={redo} next={advance} nextName={STEPS[steps[stepI + 1].kind].name} />
      ) : (
        <Exercise trainer={trainer} p={p} hold={lesson.hold} known={known} lit={lesson.adds !== undefined ? SCALE[lesson.adds] : undefined}
          kind={step.kind} mic={mic} retryMic={() => void startMic()} hint={hint} skip={skip} />
      )}
    </div>
  )
}

/** The working area: the line, the ring, the numbers, the stairs — and the two actions. */
function Exercise({ trainer: t, p, hold, known, lit, kind, mic, retryMic, hint, skip }: {
  trainer: Trainer; p: Progress; hold: number; known: number[]; lit?: number; kind: StepKind
  mic: string; retryMic: () => void; hint: () => void; skip: () => void
}) {
  const progress = Math.min(1, t.held / hold)
  const cur = t.current
  const counted = kind === 'practice' || kind === 'test'
  return (
    <>
      {/* the line to sing — the lesson's "text" */}
      <div className="mt-3 rounded-2xl border border-line bg-sub-alt/50 px-3 py-4 sm:px-6 sm:py-6">
        <div className="flex flex-wrap justify-center gap-x-1 gap-y-2 sm:gap-x-2">
          {t.notes.map((s, k) => {
            const r = t.results[k]
            const now = k === t.idx
            return (
              <span key={k} className={cx('relative font-mono text-[19px] sm:text-[26px] leading-none px-1.5 sm:px-2 pt-2 pb-2.5 rounded-md transition-colors duration-200',
                r ? (r.skipped ? 'text-error/60 line-through decoration-1' : r.off <= 12 ? 'text-main' : 'text-text/70') : now ? 'text-text bg-bg' : 'text-sub/40')}>
                <NoteText s={s} p={p} />
                {now && (
                  <span className="absolute left-1 right-1 bottom-[3px] h-[2px] rounded-full bg-line overflow-hidden">
                    <span className="block h-full bg-main" style={{ width: `${progress * 100}%` }} />
                  </span>
                )}
              </span>
            )
          })}
        </div>
      </div>

      {mic !== 'on' ? (
        mic === 'starting' ? <p className="mt-10 text-center text-[13px] text-sub">Starting the microphone…</p> : <MicProblem message={mic} retry={retryMic} />
      ) : (
        <>
          <Readout target={cur} cents={t.cents} inTune={t.inTune} sung={t.sung} progress={progress} p={p} issue={t.health.issue} />

          {/* the numbers, in one quiet line */}
          <div className="mt-5 grid grid-cols-4 divide-x divide-line text-center">
            <Figure value={`${Math.min(t.idx + 1, t.notes.length)}/${t.notes.length}`} label="note" />
            <Figure value={t.results.length ? `${t.accuracy}%` : '—'} label="in tune" />
            <Figure value={fmt(t.seconds)} label="time" />
            <Figure value={String(counted ? t.hints : t.skipped)} label={counted ? 'hints' : 'skipped'} />
          </div>

          <Stairs p={p} known={known} target={cur} lit={lit} cents={t.cents} inTune={t.inTune} />

          {/* the two actions: under the thumb on phones, quietly centred on desktop */}
          <div className="h-20 sm:hidden" />
          <div className="fixed sm:static inset-x-0 bottom-0 z-10 sm:mt-6 px-4 sm:px-0 pt-6 sm:pt-0 pb-[max(0.9rem,env(safe-area-inset-bottom))] sm:pb-0 bg-gradient-to-t from-bg via-bg to-transparent sm:bg-none">
            <div className="max-w-3xl mx-auto grid grid-cols-[1fr_auto] sm:flex sm:justify-center gap-2">
              <Btn onClick={hint}><Volume2 size={14} /> {kind === 'test' ? `Hear ${homeName(p.notation, p.home)}` : 'Hear the note'} <Kbd>space</Kbd></Btn>
              <Btn onClick={skip} aria="skip this note"><SkipForward size={13} /> Skip</Btn>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function Figure({ value, label: l }: { value: string; label: string }) {
  return (
    <div className="px-1">
      <div className="text-[15px] sm:text-base font-semibold text-text tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] text-sub mt-0.5">{l}</div>
    </div>
  )
}

/** The note to sing inside a ring that fills while you hold it, and what to do now. */
function Readout({ target, cents, inTune, sung, progress, p, issue }: { target?: number; cents: number | null; inTune: boolean; sung: number | null; progress: number; p: Progress; issue: MicIssue }) {
  const hint = cents === null ? 'Sing it' : inTune ? (progress > 0.08 ? 'Hold it…' : 'There!')
    : cents < 0 ? (cents < -150 ? 'Much higher' : 'A little higher') : cents > 150 ? 'Much lower' : 'A little lower'
  // the dot glides after your voice (a semitone each way), and rests where it was between notes
  const dot = useGlide(cents === null ? null : Math.max(-100, Math.min(100, cents)))
  return (
    <div className="mt-6 flex items-center justify-center gap-5 sm:gap-8">
      <Ring progress={progress} dim={!inTune} size={96} large={112}>
        <span className="text-[30px] sm:text-[36px] font-semibold tracking-tight text-text leading-none">{target !== undefined ? <NoteText s={target} p={p} /> : '—'}</span>
      </Ring>
      <div className="w-40 sm:w-48">
        <div className={cx('text-[15px] sm:text-base font-medium flex items-center gap-1.5 transition-colors duration-200', inTune ? 'text-main' : cents === null ? 'text-sub' : 'text-text')}>
          {cents !== null && !inTune && <span className="text-sub leading-none">{cents < 0 ? '↑' : '↓'}</span>}
          {hint}
        </div>
        <div className="mt-0.5 text-[11px] text-sub font-mono h-4 flex items-center">
          {sung !== null && cents !== null && <span>you {midiToNoteName(sung)} · {cents > 0 ? '+' : ''}{Math.round(cents)}¢</span>}
          {issue && <MicHint issue={issue} />}
        </div>
        {/* a small needle: left = low, right = high (a semitone each way), the middle band is in tune */}
        <div className="mt-2.5 relative h-[3px] rounded-full bg-line">
          <div className="absolute inset-y-0 rounded-full bg-main/30" style={{ left: `${50 - IN_TUNE / 2}%`, right: `${50 - IN_TUNE / 2}%` }} />
          <div className="absolute -top-1 -bottom-1 left-1/2 w-px bg-sub/40" />
          {dot !== null && (
            <div className={cx('absolute top-1/2 w-2.5 h-2.5 -mt-[5px] -ml-[5px] rounded-full ring-2 ring-bg transition-[background-color,opacity] duration-200', inTune ? 'bg-main' : 'bg-text', cents === null && 'opacity-30')}
              style={{ left: `${50 + dot / 2}%` }} />
          )}
        </div>
        <div className="mt-1 flex justify-between text-[9.5px] uppercase tracking-[0.12em] text-sub/60"><span>low</span><span>high</span></div>
      </div>
    </div>
  )
}

/** Eases a value toward where it's going, frame by frame (the screen redraws every frame while
    singing) — smooth, never jittery. Holds the last value while there's nothing to follow. */
function useGlide(x: number | null, seconds = 0.09) {
  const s = useRef<{ v: number | null; t: number }>({ v: null, t: 0 })
  const now = performance.now() / 1000
  const g = s.current
  if (x !== null) g.v = g.v === null ? x : g.v + (x - g.v) * (1 - Math.exp(-Math.min(0.1, now - g.t) / seconds))
  g.t = now
  return g.v
}

/** A small mark when the sound is the trouble (noise, too soft, too loud); the words on hover. */
function MicHint({ issue }: { issue: Exclude<MicIssue, null> }) {
  const why = { noisy: 'Background noise — a quieter spot helps', soft: 'Too soft — sing louder or come closer', loud: 'Too loud — move back from the mic' }[issue]
  return (
    <span title={why} aria-label={why} role="status" className="screen-in ml-auto shrink-0 inline-flex items-center gap-1 text-sub">
      {issue === 'noisy' ? <AudioWaveform size={12} /> : <MicVocal size={12} />}
      <span className="text-[10px] font-sans">{issue === 'noisy' ? 'noise' : issue}</span>
    </span>
  )
}

/**
 * The scale as a staircase, each step as tall as the note is high. The note to sing is lit,
 * with its in-tune band; your voice is a line — bring it into the band on the lit step.
 * Near the note the line moves 4× more than the steps would (a few cents shows), so you
 * can see your voice wobble and settle; further off it falls back to the steps' scale.
 */
function Stairs({ p, known, target, lit, cents, inTune }: { p: Progress; known: number[]; target?: number; lit?: number; cents: number | null; inTune: boolean }) {
  const lvl = (s: number) => 14 + (s + 1) * 6.5
  const H = lvl(13.5)
  const ZOOM = 0.25 // px per cent near the note (the steps: 0.065)
  const off = (c: number) => Math.sign(c) * (Math.abs(c) <= 100 ? Math.abs(c) * ZOOM : 100 * ZOOM + (Math.abs(c) - 100) * 0.065)
  // the line glides after your voice and rests (faded) where it was between notes
  const at = useGlide(target !== undefined && cents !== null ? Math.max(2, Math.min(H + 8, lvl(target) + off(cents))) : null)
  return (
    <div className="mt-7 relative" style={{ height: H }} aria-hidden>
      <div className="absolute inset-0 flex items-end gap-[3px] sm:gap-1">
        {SCALE.map((s) => {
          const on = s === target
          const has = known.includes(s)
          return (
            <div key={s} className={cx('flex-1 rounded-t-md relative transition-colors duration-200 border-t',
              on ? 'bg-main/15 border-main' : s === lit ? 'bg-sub-alt border-main/40' : has ? 'bg-sub-alt border-line' : 'bg-sub-alt/40 border-transparent')}
              style={{ height: lvl(s) }}>
              {/* where "in tune" is: a soft band around the top of the lit step */}
              {on && <span className="absolute inset-x-0 bg-main/20 rounded-sm" style={{ top: -IN_TUNE * ZOOM, height: IN_TUNE * ZOOM * 2 }} />}
              <span className={cx('absolute top-2 inset-x-0 text-center font-mono text-[10px] sm:text-[11px]', on ? 'text-text' : has ? 'text-sub' : 'text-sub/30')}>
                <NoteText s={s} p={p} />
              </span>
            </div>
          )
        })}
      </div>
      {at !== null && (
        <div className={cx('absolute inset-x-0 pointer-events-none transition-[color,opacity] duration-200', inTune ? 'text-main' : 'text-text', cents === null && 'opacity-30')}
          style={{ bottom: at - 1 }}>
          <div className="h-[2px] rounded-full bg-current" />
          <span className="absolute -top-3.5 left-0 text-[9.5px] font-medium uppercase tracking-[0.1em]">you</span>
        </div>
      )}
    </div>
  )
}

function StepDone({ kind, r, again, next, nextName }: { kind: StepKind; r: StepResult; again: () => void; next: () => void; nextName: string }) {
  return (
    <div className="page-in mt-3 rounded-2xl border border-line p-5 sm:p-8 text-center"
      style={{ background: 'radial-gradient(100% 80% at 50% 0%, color-mix(in srgb, var(--main) 7%, transparent), transparent 70%), var(--sub-alt)' }}>
      <div className="flex items-center justify-center gap-2">
        <span className="w-6 h-6 rounded-full bg-main text-bg flex items-center justify-center"><Check size={13} strokeWidth={3} /></span>
        <span className="text-[15px] font-semibold text-text">{STEPS[kind].name} done</span>
      </div>
      <div className="mt-3 flex justify-center"><Stars n={r.stars} size={16} /></div>
      <div className="mt-5 grid grid-cols-3 divide-x divide-line max-w-xs mx-auto">
        <Figure value={`${r.acc}%`} label="in tune" />
        <Figure value={`${r.find.toFixed(1)}s`} label="to find a note" />
        <Figure value={fmt(r.seconds)} label="time" />
      </div>
      <p className="mt-4 text-[12.5px] text-sub">{verdict(r)}</p>
      <div className="mt-5 flex justify-center gap-2">
        <Btn onClick={again}><RotateCcw size={13} /> Again</Btn>
        <Btn primary onClick={next}>Next: {nextName} <ArrowRight size={14} /> <Kbd dark>enter</Kbd></Btn>
      </div>
    </div>
  )
}

function LessonDone({ n, title, steps, results, trainer, p, best, again, next, home, r }: {
  n: number; title: string; steps: { kind: StepKind }[]; results: (StepResult | undefined)[]; trainer: Trainer; p: Progress
  best?: { acc: number; stars: number }; again: () => void; next?: () => void; home: () => void; r: StepResult
}) {
  // how each note of the test went
  const per = new Map<number, { off: number; took: number; n: number; skipped: number }>()
  trainer.notes.forEach((s, k) => {
    const x = trainer.results[k]
    if (!x) return
    const e = per.get(s) ?? { off: 0, took: 0, n: 0, skipped: 0 }
    e.off += x.skipped ? 50 : x.off
    e.took += x.took
    e.n++
    e.skipped += x.skipped ? 1 : 0
    per.set(s, e)
  })
  const notes = [...per.entries()].sort((a, b) => a[0] - b[0])
  const hardest = [...per.entries()].sort((a, b) => b[1].took / b[1].n - a[1].took / a[1].n)[0]
  return (
    <div>
      <BackLink onClick={home}>Lessons</BackLink>
      <div className="mt-6 text-center">
        <Eyebrow accent>Lesson {n} complete</Eyebrow>
        <h1 className="mt-1.5 text-[22px] sm:text-2xl font-semibold tracking-tight text-text">{title}</h1>
        <div className="mt-4 flex justify-center"><Stars n={r.stars} size={24} /></div>
        <div className="mt-6 grid grid-cols-3 divide-x divide-line max-w-xs mx-auto">
          <Figure value={`${r.acc}%`} label="in tune" />
          <Figure value={`${r.find.toFixed(1)}s`} label="to find a note" />
          <Figure value={String(r.hints)} label="hints" />
        </div>
        <p className="mt-4 text-[12.5px] text-sub max-w-sm mx-auto">
          {verdict(r)}
          {hardest && notes.length > 1 && <> Slowest to find: <b className="text-text font-medium"><NoteText s={hardest[0]} p={p} /></b>.</>}
          {best && (best.stars > r.stars || (best.stars === r.stars && best.acc > r.acc)) && <> Your best: {best.acc}%.</>}
        </p>
      </div>

      {/* each note of the test, by how close it was */}
      <div className="mt-7 rounded-2xl border border-line overflow-hidden">
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-line">
          <Eyebrow>Note by note</Eyebrow>
          <span className="text-[10.5px] text-sub">off · time to find</span>
        </div>
        <div className="px-4 py-3 flex flex-col gap-2.5">
          {notes.map(([s, e]) => {
            const off = e.off / e.n
            return (
              <div key={s} className="flex items-center gap-3 text-[11.5px]">
                <span className="w-9 font-mono text-[13px] text-text"><NoteText s={s} p={p} /></span>
                <span className="flex-1 h-[3px] rounded-full bg-line overflow-hidden">
                  <span className={cx('block h-full rounded-full', off <= 12 ? 'bg-main' : off <= 22 ? 'bg-main/55' : 'bg-sharp')} style={{ width: `${Math.max(4, 100 - off * 2)}%` }} />
                </span>
                <span className="w-24 text-right text-sub tabular-nums">{e.skipped ? `${e.skipped} skipped` : `${Math.round(off)}¢ · ${(e.took / e.n).toFixed(1)}s`}</span>
              </div>
            )
          })}
        </div>
        <div className="px-4 py-2.5 grid grid-cols-4 gap-2 border-t border-line">
          {steps.map((s, k) => (
            <div key={k} className="min-w-0">
              <div className="text-[10px] text-sub truncate">{STEPS[s.kind].name}</div>
              <div className="text-[12.5px] text-text tabular-nums">{results[k] ? `${results[k]!.acc}%` : '—'}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Btn onClick={again}><RotateCcw size={13} /> Test again</Btn>
        {next ? <Btn primary onClick={next}>Next lesson <ArrowRight size={14} /> <Kbd dark>enter</Kbd></Btn> : <Btn primary onClick={home}>All lessons</Btn>}
      </div>
    </div>
  )
}

const verdict = (r: StepResult) =>
  r.skipped ? 'Some notes were skipped — go again when you’re ready.'
    : r.stars === 3 ? 'Spot on — right on the notes, and quick to find them.'
      : r.acc >= 78 ? 'Close. Landing each note faster earns the next star.'
        : 'Getting there. Listen first, then match each note slowly.'

// =================================================================== free practice

const SUGGESTIONS = [[1, 2, 3, 4, 5], [1, 3, 5, 8, 5, 3, 1], [1, 2, 1, 2, 3, 4, 3, 4], [5, 4, 3, 2, 1], [1, 5, 8, 5, 1], [1, 2, 3, 4, 5, 6, 7, 8]]

function FreePractice({ voice, p, update, back }: { voice: VoiceIO; p: Progress; update: (x: Partial<Progress>) => void; back: () => void }) {
  const f = p.free
  const [text, setText] = useState(f.line || writeLine(toSemis(SUGGESTIONS[0]), p.notation, p.home))
  const notes = useMemo(() => parseLine(text, p.home), [text, p.home])
  const trainer = useMemo(() => new Trainer(), [])
  const [running, setRunning] = useState(false)
  const [mic, setMic] = useState<'starting' | 'on' | string>('starting')
  const [finished, setFinished] = useState(false)
  useFrames(running && mic === 'on' && !finished)

  const setFree = (x: Partial<Progress['free']>) => update({ free: { ...f, ...x } })

  const start = useCallback(async () => {
    if (!notes.length) return
    setFinished(false)
    trainer.load(notes)
    setRunning(true)
    setMic('starting')
    try {
      await voice.start()
      setMic('on')
      voice.play(p.home + notes[0])
    } catch (e) {
      setMic((e as Error).message)
    }
  }, [notes, trainer, voice, p.home])

  useEffect(() => {
    voice.onReading = (r, quiet) => {
      if (!running || finished) return
      if (!trainer.push(r, p.home, f.hold, quiet)) return
      if (trainer.done) setFinished(true)
      else if (f.autoplay) voice.play(p.home + trainer.current!)
    }
    return () => {
      voice.onReading = null
    }
  }, [voice, trainer, running, finished, p.home, f.hold, f.autoplay])

  const hint = useCallback(() => {
    if (!running || trainer.current === undefined) return
    trainer.hints++
    voice.play(p.home + trainer.current)
  }, [running, trainer, voice, p.home])
  const skip = () => {
    if (trainer.skip()) setFinished(true)
    else if (f.autoplay) voice.play(p.home + trainer.current!)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) {
        if (e.key === 'Enter') void start()
        return
      }
      if (e.key === ' ' && running && !finished) {
        e.preventDefault()
        hint()
      } else if (e.key === 'Enter' && finished) setRunning(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hint, running, start, finished])

  const example = writeLine(toSemis([1, 2, 3, 4, 5]), p.notation, p.home)
  return (
    <div>
      <BackLink onClick={running ? () => setRunning(false) : back}>{running ? 'Change the line' : 'Course'}</BackLink>
      <div className="mt-4">
        <Eyebrow accent>Free practice</Eyebrow>
        <h1 className="mt-1 text-[22px] sm:text-[26px] font-semibold tracking-tight text-text">Sing your own line</h1>
      </div>

      {!running ? (
        <div className="mt-5">
          <div className="rounded-2xl border border-line bg-sub-alt/50 focus-within:border-main/50 transition-colors">
            <input value={text} spellCheck={false} autoCapitalize="off" autoComplete="off" placeholder={example} aria-label="your notes"
              onChange={(e) => { setText(e.target.value); setFree({ line: e.target.value }) }}
              className="w-full bg-transparent px-4 pt-3.5 pb-2 text-[17px] text-text font-mono outline-none select-text" />
            <div className="px-4 pb-3 flex items-center justify-between gap-3 text-[11px] text-sub">
              <span className="truncate">Sa Re Ga · Do Re Mi · C D E · 1 2 3 — <b className="text-text font-medium">'</b> higher, <b className="text-text font-medium">,</b> lower</span>
              <span className="shrink-0 tabular-nums">{notes.length} notes</span>
            </div>
          </div>
          <div className="mt-3 -mx-4 px-4 flex gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap sm:mx-0 sm:px-0">
            {SUGGESTIONS.map((sg, k) => {
              const line = writeLine(toSemis(sg), p.notation, p.home)
              return <button key={k} type="button" onClick={() => { setText(line); setFree({ line }) }}
                className={cx('shrink-0 h-7 rounded-full border px-3 text-[11.5px] font-mono transition-colors', line === text ? 'border-main/60 text-text' : 'border-line text-sub hover:text-text')}>{line}</button>
            })}
          </div>

          <div className="mt-6 rounded-2xl border border-line divide-y divide-line">
            <div className="flex items-center justify-between gap-3 px-4 h-12">
              <span className="text-[13px] text-text">Play each note first</span>
              <Switch on={f.autoplay} onClick={() => setFree({ autoplay: !f.autoplay })} />
            </div>
            <div className="flex items-center justify-between gap-3 px-4 h-12">
              <span className="text-[13px] text-text">Hold each note</span>
              <div className="inline-grid grid-cols-3 rounded-lg bg-sub-alt p-0.5 text-[11.5px]">
                {[1, 2, 3].map((h) => (
                  <button key={h} type="button" onClick={() => setFree({ hold: h })}
                    className={cx('h-6 rounded-md px-2.5 tabular-nums transition-all', f.hold === h ? 'bg-bg text-text shadow-[0_1px_2px_rgba(0,0,0,.4)]' : 'text-sub hover:text-text')}>{h}s</button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-[auto_1fr] sm:flex gap-2">
            <Btn onClick={() => voice.playLine(notes.map((s) => p.home + s))} disabled={!notes.length}><Volume2 size={14} /> Hear it</Btn>
            <Btn primary onClick={() => void start()} disabled={!notes.length}><Mic size={14} /> Start singing</Btn>
          </div>
        </div>
      ) : finished ? (
        <StepDone kind="practice" again={() => void start()} next={() => setRunning(false)} nextName="new line"
          r={{ acc: trainer.accuracy, find: trainer.findTime, stars: starsFor(trainer.accuracy, trainer.findTime), hints: trainer.hints, skipped: trainer.skipped, seconds: trainer.seconds }} />
      ) : (
        <Exercise trainer={trainer} p={p} hold={f.hold} known={SCALE} kind={f.autoplay ? 'drill' : 'practice'}
          mic={mic} retryMic={() => void start()} hint={hint} skip={skip} />
      )}
    </div>
  )
}

// =================================================================== small pieces

function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="-ml-1 inline-flex items-center gap-0.5 h-7 pr-2 text-[12px] text-sub hover:text-text transition-colors">
      <ChevronLeft size={15} /> {children}
    </button>
  )
}

function Ring({ progress, dim, size, large, children }: { progress: number; /** not in tune right now: the held part waits, faded */ dim?: boolean; size: number; large?: number; children: ReactNode }) {
  const R = 56
  const C = 2 * Math.PI * R
  return (
    <div className="relative shrink-0 w-[var(--s)] h-[var(--s)] sm:w-[var(--l)] sm:h-[var(--l)]"
      style={{ '--s': `${size}px`, '--l': `${large ?? size}px` } as CSSProperties}>
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="var(--sub-alt)" stroke="var(--line)" strokeWidth="2.5" />
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--main)" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - progress)} strokeOpacity={dim ? 0.4 : 1} style={{ transition: 'stroke-dashoffset 80ms linear, stroke-opacity 150ms' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

function MicProblem({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="mt-6 mx-auto max-w-sm rounded-2xl border border-line p-5 text-center">
      <Mic size={16} className="mx-auto text-error" />
      <p className="mt-2 text-[13px] text-text">{message}</p>
      <div className="mt-4"><Btn onClick={retry}>Try again</Btn></div>
    </div>
  )
}

function Btn({ primary, onClick, disabled, aria, children }: { primary?: boolean; onClick: () => void; disabled?: boolean; aria?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={aria}
      className={cx('inline-flex items-center justify-center gap-1.5 h-10 sm:h-9 rounded-full px-4 text-[13px] font-medium transition-all active:scale-[.98] disabled:opacity-40 whitespace-nowrap',
        primary ? 'bg-main text-bg hover:opacity-90' : 'bg-sub-alt text-text border border-line hover:border-sub/40')}>
      {children}
    </button>
  )
}

function RoundBtn({ label: l, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={l} onClick={onClick} className="w-9 h-9 rounded-full border border-line text-base text-text hover:border-sub/40 active:scale-95 transition-all">{children}</button>
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick}
      className={cx('w-9 h-5 rounded-full relative transition-colors shrink-0', on ? 'bg-main' : 'bg-line')}>
      <span className={cx('absolute top-0.5 w-4 h-4 rounded-full bg-bg shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  )
}

function Stars({ n, size = 11 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex gap-[2px]">
      {[0, 1, 2].map((k) => <Star key={k} size={size} className={k < n ? 'fill-current text-main' : 'text-sub/30'} />)}
    </span>
  )
}

function Kbd({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return <span className={cx('hidden [@media(pointer:fine)]:inline text-[10px] font-normal rounded px-1 ml-0.5 border', dark ? 'border-bg/25 text-bg/60' : 'border-line text-sub')}>{children}</span>
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
