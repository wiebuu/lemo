import type { ReactNode } from 'react'
import { lazy, Suspense, useState } from 'react'
import { Crown, MicVocal, Music2, SlidersHorizontal, X } from 'lucide-react'
const VoiceFxPanel = lazy(() => import('./VoiceFxPanel').then((m) => ({ default: m.VoiceFxPanel })))
import { LyricTicker } from './LyricTicker'
import { availableAspects, reviewNotes, type ReviewAspect } from '../lib/review'
import { formatTime } from '../lib/music'
import type { MetricResult } from '../lib/evaluation'
import type { MetricKey } from '../lib/types'
import { studio } from '../state/studio'
import { centsInWords, cx, Tabs, Tip, usePhone, useStudio } from './ui'
import { navigate } from '../pages/router'

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)
const ORDER: MetricKey[] = ['shape', 'harmony', 'rhythm', 'tone', 'attack', 'stability', 'dynamics', 'exact']
const SHORT: Record<MetricKey, string> = { shape: 'shape', harmony: 'in key', rhythm: 'rhythm', tone: 'tone', attack: 'attack', stability: 'steadiness', dynamics: 'dynamics', exact: 'exact notes' }
const ABOUT: Record<MetricKey, string> = {
  shape: 'Did your voice go up and down like the melody? Your key doesn’t matter here.',
  harmony: 'Were you in tune with the music? Singing an octave up or down is fine; any other key clashes with the backing.',
  tone: 'How clean your voice sounded. Breathy, raspy or strained singing scores lower. (A noisy room or weak mic lowers it too.)',
  attack: 'Did you land straight on each note, or slide / scoop up into it?',
  rhythm: 'Did you come in on time and leave the gaps empty?',
  stability: 'How steady your long notes were. Vibrato is fine.',
  dynamics: 'Did you sing softer and stronger where the original does?',
  exact: 'Did you hit the original singer’s actual notes?',
}
/** Clicking a score shows that aspect on the graph. */
const ASPECT_OF: Record<MetricKey, ReviewAspect> = { shape: 'pitch', harmony: 'key', tone: 'tone', attack: 'attack', exact: 'pitch', rhythm: 'timing', stability: 'steadiness', dynamics: 'loudness' }
const LEVEL_NAME: Record<number, string> = { 100: 'easy', 50: 'normal', 25: 'strict' }
const ASPECT_WORD: Record<ReviewAspect, string> = { pitch: 'pitch', key: 'key', tone: 'tone', attack: 'attack', timing: 'timing', steadiness: 'steadiness', loudness: 'loudness' }

/**
 * After a test: one panel with a small header — results | lyrics, you | original
 * (your take is already loaded, ▶ plays it) and ✕ back to practice.
 */
export function ResultsPanel({ big }: { big?: boolean }) {
  const s = useStudio()
  const phone = usePhone()
  if (!s.lastResult) return null
  // phones: just the results — every score on the screen, no switching to the lyrics
  if (phone) return (
    <div className="fade-in w-full h-full flex flex-col justify-center overflow-hidden">
      <ResultsBody tabs={null} compact />
    </div>
  )
  const tabs = (
    <div className="w-32 sm:w-40 shrink-0">
      <Tabs<'results' | 'lyrics'> value={s.resultsView} onChange={(v) => studio.setResultsView(v)}
        options={[{ value: 'results', label: 'results' }, { value: 'lyrics', label: 'lyrics' }]} />
    </div>
  )
  return s.resultsView === 'results' ? (
    <div className="fade-in w-full h-full flex flex-col justify-center overflow-hidden">
      <ResultsBody tabs={tabs} />
    </div>
  ) : (
    <div className="fade-in w-full h-full flex items-start gap-3">
      <div className="flex-1 min-w-0 h-full flex flex-col justify-center overflow-hidden"><LyricTicker big={big} /></div>
      {tabs}
    </div>
  )
}

/**
 * Above the graph on the results: you | original, voice effects, and ✕ back to
 * practice.
 */
export function ListenControls({ noSwitch }: { /** the you / song switch is shown elsewhere (phones: centred) */ noSwitch?: boolean }) {
  const s = useStudio()
  const phone = usePhone()
  const [fxOpen, setFxOpen] = useState(false)
  const fx = s.voiceFx
  const fxOn = fx.pitch !== 0 || fx.tune !== 0 || fx.echo !== 0 || fx.reverb !== 0 || fx.tone !== 0 || fx.volume !== 1
  return (
    <div className="fade-in flex items-center gap-1.5">
      {fxOpen && s.replay && <Suspense fallback={null}><VoiceFxPanel onClose={() => setFxOpen(false)} /></Suspense>}
      {s.canReplay && !noSwitch && <VoiceSwitch />}
      {s.canReplay && s.replay && !phone && ( // phones: kept simple
        <Tip tip="Voice effects: tune, pitch, echo, reverb">
          <button type="button" onClick={() => { setFxOpen((o) => !o); studio.setListenSource('me') }} aria-label="voice effects" aria-pressed={fxOpen}
            className={cx('relative w-10 h-10 rounded-full flex items-center justify-center transition-colors', fxOpen ? 'bg-main text-bg' : 'text-sub hover:text-text hover:bg-sub-alt')}>
            <SlidersHorizontal size={19} />
            {fxOn && !fxOpen && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-main" />}
          </button>
        </Tip>
      )}
      <Tip tip="Back to practice">
        <button type="button" onClick={() => studio.leaveReview()} aria-label="back to practice"
          className="w-10 h-10 rounded-full text-sub flex items-center justify-center hover:text-text hover:bg-sub-alt">
          <X size={19} />
        </button>
      </Tip>
    </div>
  )
}

/** Play your take or the original singer — switching never stops the music. */
export function VoiceSwitch() {
  const s = useStudio()
  const me = s.listenSource === 'me'
  const canOriginal = !!s.caps?.hasGuide
  return (
    <div className="relative flex items-center bg-sub-alt rounded-full p-0.5 text-[11px]">
      <span className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-full bg-main transition-transform duration-300 ease-out"
        style={{ transform: me ? 'translateX(0)' : 'translateX(100%)' }} />
      <Tip tip="▶ plays your take with the music (V)">
        <button type="button" onClick={() => studio.setListenSource('me')}
          className={cx('relative z-10 flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-full w-14 sm:w-[5.5rem] justify-center', me ? 'text-bg' : 'text-sub hover:text-text')}>
          <MicVocal size={12} /> you
        </button>
      </Tip>
      <Tip tip={canOriginal ? '▶ plays the original singer, to compare (V)' : 'This song has no separate original vocal.'}>
        <button type="button" onClick={() => studio.setListenSource('original')} disabled={!canOriginal}
          className={cx('relative z-10 flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-full w-14 sm:w-[5.5rem] justify-center disabled:opacity-30', !me ? 'text-bg' : 'text-sub hover:text-text')}>
          <Music2 size={12} /> <span className="hidden sm:inline">original</span><span className="sm:hidden">song</span>
        </button>
      </Tip>
    </div>
  )
}

/** Scores (click one to shade that aspect on the graph) and one line of detail. */
function ResultsBody({ tabs, compact }: { tabs: React.ReactNode; /** phones: all scores in a grid, a little smaller */ compact?: boolean }) {
  const s = useStudio()
  const r = s.lastResult!
  const notes = s.track?.notes ?? []
  const keys = ORDER.filter((k) => k !== 'exact' || s.settings.scoringMode === 'exact')
  const aspects = availableAspects(r, notes)
  const aspect = aspects.includes(s.reviewAspect) ? s.reviewAspect : 'pitch'
  const weights = Object.keys(r.overall.weights).map((k) => SHORT[k as MetricKey])
  const phrase = s.loop ? s.attempts[s.attempts.length - 1]?.phrase ?? null : null
  const history = s.attempts.filter((a) => a.phrase === phrase).slice(-12)
  return (
    <div className="w-full flex flex-col gap-2">
      {/* one row; on narrow screens it scrolls sideways instead of wrapping out of its space */}
      <div className="flex items-center gap-3">
      <div className={compact ? 'flex-1 min-w-0 grid grid-cols-4 items-end gap-x-2 gap-y-2'
        : 'edge-fade flex-1 min-w-0 flex flex-nowrap items-end gap-x-5 overflow-x-auto [&>*]:shrink-0 -mx-1 px-1 py-0.5'}>
        {s.settings.showOverall && (
          <Tip wide tip={weights.length ? <>The average of your {weights.length} scores ({weights.join(', ')}), each counting the same. Today's top shows this same number.</> : 'Not enough singing for an overall score.'}>
            <div className="cursor-default">
              <div className={cx('text-main font-medium tabular-nums leading-none', compact ? 'text-3xl' : 'text-4xl')}>{pct(r.overall.score)}</div>
              <div className="text-sub text-[11px] mt-1">overall</div>
            </div>
          </Tip>
        )}
        {keys.map((k) => (
          <MetricTile key={k} k={k} m={r.metrics[k]} selected={ASPECT_OF[k] === aspect && (k !== 'exact' || !keys.includes('shape'))}
            selectable={aspects.includes(ASPECT_OF[k])} compact={compact} />
        ))}
        {s.settings.showHistory && history.length > 1 && !compact && (
          <Tip tip="Your recent tries — the bright bar is this one.">
            <div className="flex items-end gap-[3px] h-7 ml-auto">
              {history.map((a, i) => (
                <div key={a.id} className={cx('w-1.5 rounded-sm', i === history.length - 1 ? 'bg-main' : 'bg-sub/60')}
                  style={{ height: `${Math.max(10, ((a.scores.overall ?? a.scores.shape) ?? 0) * 100)}%` }} />
              ))}
            </div>
          </Tip>
        )}
      </div>
      {tabs}
      </div>
      <DetailLine aspect={aspect} />
    </div>
  )
}

function MetricTile({ k, m, selected, selectable, compact }: { k: MetricKey; m: MetricResult; selected: boolean; selectable: boolean; compact?: boolean }) {
  const lines = m.score === null ? [`Couldn't measure this time: ${m.note}.`] : plainDetails(k, m)
  return (
    <Tip wide tip={<>{ABOUT[k]}{lines.map((l) => <span key={l} className="block mt-1 opacity-80">{l}</span>)}{selectable && <span className="block mt-1 opacity-60">Click to see where on the graph.</span>}</>}>
      <button type="button" disabled={!selectable} onClick={() => studio.setReviewAspect(ASPECT_OF[k])}
        className={cx('text-left pb-1 border-b-2', selected ? 'border-main' : 'border-transparent hover:border-sub-alt', !selectable && 'cursor-default')}>
        <div className={cx('tabular-nums leading-none', compact ? 'text-lg' : 'text-xl', m.score === null ? 'text-sub' : 'text-text')}>{pct(m.score)}</div>
        <div className={cx('mt-1 truncate', compact ? 'text-[10px]' : 'text-[11px]', selected ? 'text-main' : 'text-sub')}>{SHORT[k]}</div>
      </button>
    </Tip>
  )
}

/** One line: what was sung, any chord clashes, and the worst moments for the selected aspect. */
function DetailLine({ aspect }: { aspect: ReviewAspect }) {
  const s = useStudio()
  const r = s.lastResult!
  const notes = s.track?.notes ?? []
  const list = reviewNotes(r, notes, aspect, s.settings.toleranceCents, s.settings.scoringMode === 'exact')
  const bad = list.filter((n) => n.severity !== null && n.severity > 0.02).sort((a, b) => b.severity! - a.severity!)
  const word = (i: number) => {
    const n = notes[i]
    if (n?.lyric?.trim()) return n.lyric.trim()
    for (const l of s.lyricsShown) for (const w of l.words ?? []) if (w.end > n.startTime && w.start < n.endTime) return w.text.trim()
    return null
  }
  return (
    <div className="edge-fade flex flex-nowrap items-center gap-x-3 text-xs text-sub min-h-5 whitespace-nowrap overflow-x-auto [&>*]:shrink-0">
      {s.viewing && (
        <Tip tip={s.viewing.hasVoice ? 'A take from today’s top. ▶ plays their voice with the music.' : 'A take from today’s top. They kept their voice private: ▶ plays the original singer, with their pitch line.'}>
          <button type="button" onClick={() => navigate('/top')} className="flex items-center gap-1.5 pl-0.5 pr-2 py-0.5 rounded-full bg-main text-bg">
            {s.viewing.photo
              ? <img src={s.viewing.photo} alt="" referrerPolicy="no-referrer" className="w-4 h-4 rounded-full" />
              : <Crown size={12} className="ml-1" />}
            {s.viewing.name}{s.viewing.rank ? ` · #${s.viewing.rank} today` : ''}{s.viewing.hasVoice ? '' : ' · voice private'}
          </button>
        </Tip>
      )}
      {s.topRank && (
        <Tip tip={s.topRank.saving ? 'Saving your take to today’s top…' : s.topRank.voice === 'shared' ? 'Your take is on today’s top — others can open it and hear you.' : 'Your take is on today’s top — others can see your result and pitch line (your voice stays private).'}>
          <button type="button" onClick={() => navigate('/top')} className={cx('flex items-center gap-1 px-2 py-0.5 rounded-full bg-main text-bg', s.topRank.saving && 'opacity-60')}>
            <Crown size={12} /> #{s.topRank.rank} in today’s top{s.topRank.saving ? '…' : ''}
          </button>
        </Tip>
      )}
      {s.resultMode && (
        <Tip tip={`Scored on ${LEVEL_NAME[s.resultMode.toleranceCents] ?? 'custom'} difficulty, ${s.resultMode.scoringMode === 'exact' ? 'checking the original notes' : 'melody shape (any key)'}.`}>
          <span className="px-2 py-0.5 rounded-full bg-sub-alt text-text cursor-default">
            {LEVEL_NAME[s.resultMode.toleranceCents] ?? 'custom'} · {s.resultMode.scoringMode === 'exact' ? 'exact notes' : 'melody shape'}
          </span>
        </Tip>
      )}
      <span>sang {r.notesSung}/{r.notesTotal} notes</span>
      {r.keyOffset !== null && <span>· {keyText(r.keyOffset)}</span>}
      {(r.harmony.keyClash || r.harmony.clashes > 0) && (
        <Tip wide tip={
          r.harmony.keyClash
            ? 'You sang in a different key from the music, so your notes don’t fit its chords and sound out of tune against it — even when your melody shape is right. Use the key picker in the top bar to move the music to your key.'
            : 'Some notes didn’t fit the chord the music was playing at that moment, so they sound off against the backing. Often it means you drifted slightly out of the song’s key.'
        }>
          <span className="text-error underline decoration-dotted underline-offset-4 cursor-help">
            · {r.harmony.keyClash ? 'your key clashes with the music' : `${r.harmony.clashes} ${r.harmony.clashes === 1 ? 'note' : 'notes'} clashed with the chords`}
          </span>
        </Tip>
      )}
      {Math.abs(r.timeOffsetMs) >= 60 && !s.viewing && (
        <Tip wide tip={<>Your whole line sits {Math.abs(r.timeOffsetMs)} ms {r.timeOffsetMs > 0 ? 'behind' : 'ahead of'} the melody. That's usually headphone delay (Bluetooth adds 150–300 ms), not your timing. Fixing it shifts the melody to match what you hear — this take is re-aligned too.</>}>
          <button type="button" onClick={() => studio.applySyncFix(r.timeOffsetMs)}
            className="text-main underline decoration-dotted underline-offset-4 hover:decoration-solid">
            · line {Math.abs(r.timeOffsetMs)} ms {r.timeOffsetMs > 0 ? 'late' : 'early'} — fix sync
          </button>
        </Tip>
      )}
      <span className="text-sub/40">|</span>
      {bad.length === 0 ? (
        <span>{ASPECT_WORD[aspect]}: nothing to fix</span>
      ) : (
        <>
          <span><span className="text-error">{bad.length}</span> off in {ASPECT_WORD[aspect]}:</span>
          {bad.slice(0, 3).map((n) => {
            const note = notes[n.noteIndex]
            const w = word(n.noteIndex)
            return (
              <Tip key={n.noteIndex} tip="Jump the graph to this spot">
                <button type="button" onClick={() => studio.seek(Math.max(0, note.startTime - 1))}
                  className="text-text hover:text-main underline underline-offset-4 decoration-2"
                  style={{ textDecorationColor: `color-mix(in srgb, var(--error) ${Math.round(35 + 65 * n.severity!)}%, transparent)` }}>
                  {w ? `“${w}” ` : ''}{formatTime(note.startTime)} {n.label}
                </button>
              </Tip>
            )
          })}
        </>
      )}
    </div>
  )
}

/** Your key against the original's, the way it sounds with the music: octaves don't count. */
function keyText(k: number): ReactNode {
  const r = Math.round(k)
  const oct = Math.round(r / 12)
  const away = r - 12 * oct // −6 … +6
  const octave = oct === 0 ? '' : ` (${Math.abs(oct) === 1 ? 'an octave' : `${Math.abs(oct)} octaves`} ${oct > 0 ? 'up' : 'down'})`
  if (Math.abs(k - 12 * oct) < 0.5) return oct === 0 ? 'original key' : `original key${octave}`
  return `${Math.abs(away)} ${Math.abs(away) === 1 ? 'key' : 'keys'} ${away > 0 ? 'higher' : 'lower'}${octave}`
}

/** Details in plain language (no cents, no dB jargon). */
function plainDetails(k: MetricKey, m: MetricResult): string[] {
  const d = m.details
  const n = (x: unknown) => (typeof x === 'number' ? x : null)
  switch (k) {
    case 'shape':
      return [`Right direction: ${pct(n(d.direction))} · right size of jumps: ${pct(n(d.intervals))}`]
    case 'rhythm': {
      const on = n(d.medianOnsetMs)
      return [on === null ? '' : Math.abs(on) <= 30 ? 'You came in right on time.' : `You usually came in ${Math.abs(on) < 150 ? 'a little' : 'quite'} ${on > 0 ? 'late' : 'early'}.`].filter(Boolean)
    }
    case 'stability':
      return [n(d.unstable) || n(d.wobble) ? `${d.unstable} long notes wavered.` : 'No wavering — nice.']
    case 'dynamics':
      return [n(d.yourRangeDb) !== null && n(d.refRangeDb) !== null && n(d.yourRangeDb)! < n(d.refRangeDb)! * 0.5 ? 'Try more contrast between soft and strong.' : 'Good contrast between soft and strong.']
    case 'exact':
      return [`Hit ${d.hit} of ${d.notes} notes, on average ${centsInWords(n(d.avgOffCents))}.`]
    case 'harmony': {
      const k = n(d.keyOffset) ?? 0
      const away = Math.abs(k - 12 * Math.round(k / 12))
      const lines = [away < 0.3 ? 'Your key matches the music.' : `Your key is ${Math.round(away) || 'a fraction of'} ${Math.round(away) === 1 ? 'key' : 'keys'} away from the music — use the key picker to move the music to you.`]
      if (n(d.clashes)) lines.push(`${d.clashes} of ${d.checked} notes didn\u2019t fit the chords.`)
      return lines
    }
    case 'tone': {
      const noisy = n(d.noisy) ?? 0
      return [noisy < 0.1 ? 'Clean, clear sound.' : noisy < 0.3 ? 'A little breathy in places.' : 'Quite breathy or rough — try more support from your breath.']
    }
    case 'attack': {
      const ms = n(d.medianSettleMs)
      const lines = [ms === null ? '' : ms <= 70 ? 'You landed straight on the notes.' : `It took about ${ms} ms to settle on a note.`]
      if (n(d.scoops)) lines.push(`You scooped up into ${d.scoops} notes.`)
      return lines.filter(Boolean)
    }
  }
}
