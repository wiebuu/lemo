import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Languages,
  AudioLines, AudioWaveform, Clock, Wind, Crosshair, Gauge, Metronome, Minus, Piano, Plus, SignalHigh, SignalLow, SignalMedium, SlidersHorizontal, Spline, Target, Waves,
} from 'lucide-react'
import type { LyricsScript } from '../state/persist'
import { studio } from '../state/studio'
import { PREVIEW } from './previews'
import { cx, Divider, IconToggle, Menu, MenuItem, MenuLabel, Tip, useStudio } from './ui'

const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1]
/** What the analyzer can render: half speed up to 1.25×, in steps of 0.05. */
const SPEED_MIN = 0.5
const SPEED_MAX = 1.25
const SPEED_STEP = 0.05
const speedLabel = (v: number) => `${+v.toFixed(2)}×`
const KEY_RANGE = 12

const DETAILS = [
  { id: 'smooth' as const, icon: Spline, tip: 'Calm lines, easiest to follow.' },
  { id: 'natural' as const, icon: Waves, tip: 'Keeps vibrato and slides.' },
  { id: 'detailed' as const, icon: AudioWaveform, tip: 'Every tiny movement.' },
]

/** How close counts as "on the line". Beginners see levels, not cents. */
export const LEVELS = [
  { cents: 100, icon: SignalLow, name: 'easy', tip: 'Within one piano key counts as on the line.' },
  { cents: 50, icon: SignalMedium, name: 'normal', tip: 'Within half a piano key.' },
  { cents: 25, icon: SignalHigh, name: 'strict', tip: 'Within a quarter of a piano key.' },
]

/**
 * Monkeytype-style pill: only the everyday controls (speed, key, loop, click).
 * Difficulty, scoring mode and graph layers live in one menu.
 */
export function ConfigBar() {
  const s = useStudio()
  const caps = s.caps
  const st = s.settings
  const toggleLayer = (k: keyof typeof st.layers) => studio.updateSettings({ layers: { ...st.layers, [k]: !st.layers[k] } })
  const level = LEVELS.find((l) => l.cents === st.toleranceCents) ?? LEVELS[1]
  const LevelIcon = level.icon

  // Why a control is unavailable right now — shown on hover instead of a dead button.
  const audioWhy = s.replay ? 'Locked while you listen back.' : s.busy ? `Wait — ${s.busy}…` : undefined
  const speedWhy = audioWhy ?? (caps?.canSpeed ? undefined : 'Speed change needs a song analysed by Lemody (not a plain audio file).')
  const keyWhy = audioWhy ?? (caps?.canTranspose ? undefined : 'Key change needs a song analysed by Lemody (not a plain audio file).')

  return (
    <div className="flex justify-center">
      <div className="surface rounded-full px-2 sm:px-3 py-0.5 text-xs flex items-center gap-0.5 sm:gap-2 max-w-full overflow-x-auto [scrollbar-width:none]">
        <Menu
          tip={speedWhy ?? 'Speed — slow the song down to learn it. The pitch stays the same.'}
          disabled={!!speedWhy}
          active={s.speed !== 1}
          buttonClassName={cx('px-1.5', speedWhy && 'opacity-40')}
          button={<span className="flex items-center gap-1.5"><Gauge size={15} /><span className="tabular-nums text-xs">{speedLabel(s.speed)}</span></span>}
        >
          {(close) => <SpeedPicker value={s.speed} onPick={(v) => { close(); if (v !== s.speed) studio.setVariant(v, s.transpose) }} />}
        </Menu>
        <Divider />
        <Menu
          tip={keyWhy ?? 'Key — move the music up or down to fit your voice. One step = one piano key.'}
          disabled={!!keyWhy}
          active={s.transpose !== 0}
          buttonClassName={cx('px-1.5', keyWhy && 'opacity-40')}
          button={<span className="flex items-center gap-1.5"><Piano size={15} /><span className="tabular-nums text-xs">{s.transpose > 0 ? '+' : ''}{s.transpose}</span></span>}
        >
          {(close) => (
            <KeyPicker value={s.transpose} onPick={(k) => { close(); if (k !== s.transpose) studio.setVariant(s.speed, k) }} />
          )}
        </Menu>
        {/* bigger screens: metronome, breath marks and the lyrics script */}
        <span className="hidden sm:contents">
        <Divider />
        <IconToggle tip="Metronome — a click on each beat (K)" preview={PREVIEW.metronome} active={s.metronome}
          disabled={!s.track?.tempo} why="This song's tempo is unknown, so there's no beat to click." onClick={() => studio.toggleMetronome()}>
          <Metronome size={15} />
        </IconToggle>
        <Divider />
        <span className="flex items-center">
          <IconToggle tip={st.showBreaths ? 'Hide breath marks' : 'Show breath marks'} preview={PREVIEW.breath} active={st.showBreaths}
            onClick={() => studio.updateSettings({ showBreaths: !st.showBreaths })}>
            <Wind size={15} />
          </IconToggle>
          <IconToggle tip="Add a breath mark at the playhead (B) — again on the same spot removes it" onClick={() => studio.addBreath()}
            disabled={!s.track} why="Load a song first.">
            <Plus size={12} />
          </IconToggle>
        </span>
        <Divider />
        <Menu tip="Lyrics script — Hinglish, Hindi or Urdu" active={st.lyricsScript !== 'original'}
          button={<span className="flex items-center gap-1"><Languages size={15} /><span className="text-[11px]">{SCRIPTS.find((x) => x.id === st.lyricsScript)!.short}</span></span>}>
          {(close) => (
            <>
              <MenuLabel>show lyrics in</MenuLabel>
              {SCRIPTS.map(({ id, label, sample, tip }) => (
                <MenuItem key={id} icon={<span className="w-5 text-center text-[13px] text-text">{sample}</span>} label={label} tip={tip}
                  active={st.lyricsScript === id} onClick={() => { close(); studio.updateSettings({ lyricsScript: id }) }} />
              ))}
            </>
          )}
        </Menu>
        </span>
        {/* phones: just the lyrics script (no metronome or breath marks) */}
        <span className="contents sm:hidden">
          <Divider />
          <Menu tip="Lyrics script — as found, Hinglish, Hindi or Urdu" active={st.lyricsScript !== 'original'} button={<Languages size={16} />}>
            {(close) => (
              <>
                <MenuLabel>show lyrics in</MenuLabel>
                {SCRIPTS.map(({ id, label, sample, tip }) => (
                  <MenuItem key={id} icon={<span className="w-5 text-center text-[13px] text-text">{sample}</span>} label={label} tip={tip}
                    active={st.lyricsScript === id} onClick={() => { close(); studio.updateSettings({ lyricsScript: id }) }} />
                ))}
              </>
            )}
          </Menu>
        </span>
        <Divider />
        <Menu tip={`Difficulty: ${level.name} · scoring · what to show`} button={<span className="flex items-center gap-1"><span className="hidden sm:contents"><LevelIcon size={15} /></span><SlidersHorizontal size={15} /></span>}>
          <MenuLabel>difficulty</MenuLabel>
          {LEVELS.map(({ cents, icon: Icon, name, tip }) => (
            <MenuItem key={cents} icon={<Icon size={14} />} label={name} tip={tip} preview={PREVIEW.level(cents / 4)} active={st.toleranceCents === cents}
              onClick={() => studio.updateSettings({ toleranceCents: cents })} />
          ))}
          <MenuLabel>scoring</MenuLabel>
          <MenuItem icon={<Waves size={14} />} label="melody shape" active={st.scoringMode === 'shape'} preview={PREVIEW.shapeMode}
            tip="Sing in any key — the shape of the melody counts."
            onClick={() => studio.updateSettings({ scoringMode: 'shape' })} />
          <MenuItem icon={<Crosshair size={14} />} label="exact notes" active={st.scoringMode === 'exact'} preview={PREVIEW.exactMode}
            tip="Also checks the original singer's exact notes."
            onClick={() => studio.updateSettings({ scoringMode: 'exact', layers: { ...st.layers, exact: true } })} />
          <MenuLabel>headphone delay</MenuLabel>
          <SyncControl />
          <MenuLabel>line detail</MenuLabel>
          <div className="flex gap-1 px-1">
            {DETAILS.map(({ id, icon: Icon, tip }) => (
              <Tip key={id} tip={tip} className="flex-1" preview={PREVIEW[id]}>
                <button type="button" onClick={() => studio.updateSettings({ lineDetail: id })}
                  className={cx('w-full flex flex-col items-center gap-1 py-1.5 rounded-md text-[10px]',
                    st.lineDetail === id ? 'text-main bg-bg/60' : 'text-sub hover:text-text hover:bg-bg/40')}>
                  <Icon size={14} />{id}
                </button>
              </Tip>
            ))}
          </div>
          <MenuLabel>show</MenuLabel>
          <MenuItem icon={<Spline size={14} />} label="my line, in the song's key" active={st.layers.shape} preview={PREVIEW.shapeLine}
            tip="Your line shifted onto the melody, whatever key you sing in." onClick={() => toggleLayer('shape')} />
          <MenuItem icon={<Target size={14} />} label="my line, real pitch" active={st.layers.exact} preview={PREVIEW.exactLine}
            tip="Your line exactly where you sang it." onClick={() => toggleLayer('exact')} />
          <MenuItem icon={<AudioLines size={14} />} label="loudness" active={st.layers.loudness} preview={PREVIEW.loudness}
            tip="Soft and strong parts: the original (bars) vs. you (line)." onClick={() => toggleLayer('loudness')} />
          <MenuItem icon={<Clock size={14} />} label="timing" active={st.layers.timing} preview={PREVIEW.timing}
            tip="Phrase edges, and when you came in (orange late, blue early)." onClick={() => toggleLayer('timing')} />
        </Menu>
      </div>
    </div>
  )
}

const SCRIPTS: { id: LyricsScript; label: string; short: string; sample: string; tip: string }[] = [
  { id: 'original', label: 'as found', short: 'Aa', sample: '—', tip: 'Whatever script the lyrics came in.' },
  { id: 'latin', label: 'Hinglish', short: 'Hi', sample: 'tum', tip: 'Hindi / Urdu words in English letters: "tum hi ho".' },
  { id: 'deva', label: 'हिंदी', short: 'हि', sample: 'तुम', tip: 'Devanagari script.' },
  { id: 'urdu', label: 'اردو', short: 'ار', sample: 'تم', tip: 'Urdu (Nastaliq) script, right to left.' },
]

/**
 * Speed: a slider for any speed from 0.5× to 1.25×, and the usual ones one tap away.
 * The song is converted once you let go (not on every step of the drag).
 */
function SpeedPicker({ value, onPick }: { value: number; onPick: (v: number) => void }) {
  const [draft, setDraft] = useState(value)
  const input = useRef<HTMLInputElement>(null)
  const pick = useRef(onPick)
  useEffect(() => {
    pick.current = onPick
  })
  // the native "change" fires once, when the slider is let go (React's onChange fires on every step)
  useEffect(() => {
    const el = input.current!
    const commit = () => pick.current(+(Math.round(Number(el.value) / SPEED_STEP) * SPEED_STEP).toFixed(2))
    el.addEventListener('change', commit)
    return () => el.removeEventListener('change', commit)
  }, [])
  const pct = ((draft - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100
  return (
    <div>
      <MenuLabel>speed · the pitch stays the same</MenuLabel>
      <div className="flex items-baseline justify-center gap-1 pt-1 pb-2">
        <span className="text-2xl font-medium tabular-nums text-text">{+draft.toFixed(2)}</span>
        <span className="text-sm text-sub">×</span>
      </div>
      <div className="px-1">
        <input type="range" min={SPEED_MIN} max={SPEED_MAX} step={SPEED_STEP} value={draft} aria-label="speed"
          className="speed-range w-full" style={{ '--fill': `${pct}%` } as CSSProperties}
          ref={input} onChange={(e) => setDraft(Number(e.target.value))} />
        <div className="flex justify-between text-[10px] text-sub/70 tabular-nums -mt-0.5">
          <span>{speedLabel(SPEED_MIN)}</span><span>{speedLabel(SPEED_MAX)}</span>
        </div>
      </div>
      <div className="flex gap-1 px-1 mt-2">
        {SPEEDS.map((v) => (
          <button key={v} type="button" onClick={() => onPick(v)}
            className={cx('flex-1 h-7 rounded-md text-[11px] tabular-nums transition-colors',
              v === value ? 'bg-main text-bg' : 'text-sub hover:text-text hover:bg-bg/40')}>
            {speedLabel(v)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Every key from −12 to +12 in one grid — jump straight to the one that fits your voice. */
function KeyPicker({ value, onPick }: { value: number; onPick: (k: number) => void }) {
  const keys = Array.from({ length: 2 * KEY_RANGE + 1 }, (_, i) => i - KEY_RANGE)
  return (
    <div>
      <MenuLabel>key · piano keys up or down</MenuLabel>
      <div className="grid grid-cols-5 gap-1 px-1">
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => onPick(k)}
            className={cx('h-8 rounded-md text-xs tabular-nums transition-colors',
              k === value ? 'bg-main text-bg' : k === 0 ? 'bg-bg/60 text-text hover:bg-bg' : 'text-sub hover:text-text hover:bg-bg/40',
              Math.abs(k) === 12 && k !== value && 'text-text')}>
            {k > 0 ? '+' : ''}{k}
          </button>
        ))}
      </div>
      <div className="flex gap-1 px-1 mt-2">
        <button type="button" onClick={() => onPick(-12)} className="flex-1 h-7 rounded-md text-[11px] whitespace-nowrap text-sub hover:text-text hover:bg-bg/40">octave ↓</button>
        <button type="button" onClick={() => onPick(0)} className="flex-1 h-7 rounded-md text-[11px] whitespace-nowrap text-sub hover:text-text hover:bg-bg/40">original</button>
        <button type="button" onClick={() => onPick(12)} className="flex-1 h-7 rounded-md text-[11px] whitespace-nowrap text-sub hover:text-text hover:bg-bg/40">octave ↑</button>
      </div>
    </div>
  )
}

/**
 * Headphone delay: moves the graph a little later than the audio so the melody
 * lines up with what you hear (wireless headphones add delay) and with your voice.
 */
function SyncControl() {
  const s = useStudio()
  const manual = s.settings.latencyMs
  const ms = Math.round(studio.latencySec * 1000)
  const step = (d: number) => studio.setHeadphoneDelay(ms + d)
  return (
    <Tip tip="If your line always trails the melody, add delay. Wired headphones: ~20–50 ms. Bluetooth: ~150–300 ms." preview={PREVIEW.delay}>
      <div className="flex items-center gap-1 px-1 w-full">
        <button type="button" onClick={() => step(-20)} className="w-8 h-7 rounded-md text-sub hover:text-text hover:bg-bg/40" aria-label="less delay"><Minus size={13} className="mx-auto" /></button>
        <span className="flex-1 text-center text-xs tabular-nums text-text">{ms} ms</span>
        <button type="button" onClick={() => step(20)} className="w-8 h-7 rounded-md text-sub hover:text-text hover:bg-bg/40" aria-label="more delay"><Plus size={13} className="mx-auto" /></button>
        <button type="button" onClick={() => studio.setHeadphoneDelay(null)}
          className={cx('px-2 h-7 rounded-md text-[11px]', manual === null ? 'text-main bg-bg/60' : 'text-sub hover:text-text hover:bg-bg/40')}>auto</button>
      </div>
    </Tip>
  )
}
