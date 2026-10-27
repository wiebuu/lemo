import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronFirst, Circle, Mic, MicOff, MicVocal, Music, Pause, Play, RefreshCcwDot, Repeat, SkipBack, SkipForward, Square, UserRound, Volume2 } from 'lucide-react'
import { formatTime } from '../lib/music'
import { studio } from '../state/studio'
import { PREVIEW } from './previews'
import { cx, IconToggle, Menu, MenuLabel, Tip, useStudio } from './ui'

export function PlayerBar() {
  const s = useStudio()
  const fill = useRef<HTMLDivElement>(null)
  const cur = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const duration = studio.snap.track?.duration ?? 0

  useEffect(
    () =>
      studio.onLive((l) => {
        if (!fill.current) return
        const d = l.duration || 1
        fill.current.style.width = `${(Math.min(l.time, d) / d) * 100}%`
        if (cur.current) cur.current.textContent = formatTime(l.time)
      }),
    [],
  )

  const seekFromPointer = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    studio.seek(((clientX - r.left) / r.width) * duration)
  }

  const disabled = !s.track || !!s.busy
  return (
    <div className="pb-2 pt-1 shrink-0">
      {/* seek bar */}
      <div className="flex items-center gap-3 text-xs text-sub tabular-nums">
        <span ref={cur} className="w-10 text-right">0:00</span>
        <div
          ref={bar}
          className="group relative flex-1 h-4 cursor-pointer"
          onPointerDown={(e) => {
            if (disabled) return
            e.currentTarget.setPointerCapture(e.pointerId)
            seekFromPointer(e.clientX)
          }}
          onPointerMove={(e) => e.buttons === 1 && !disabled && seekFromPointer(e.clientX)}
        >
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] group-hover:h-[5px] transition-all rounded bg-sub-alt overflow-hidden">
            {s.focus && duration > 0 && (
              <div className="absolute inset-y-0 bg-text/25 rounded"
                style={{ left: `${(s.focus.start / duration) * 100}%`, width: `${((s.focus.end - s.focus.start) / duration) * 100}%` }} />
            )}
            {s.loop && duration > 0 && (
              <div
                className="absolute inset-y-0 bg-sub/40"
                style={{ left: `${(s.loop.start / duration) * 100}%`, width: `${((s.loop.end - s.loop.start) / duration) * 100}%` }}
              />
            )}
            <div ref={fill} className="absolute inset-y-0 left-0 bg-grad rounded-full" style={{ width: 0 }} />
          </div>
          {duration > 0 &&
            s.phrases.map((p) => (
              <div
                key={p.index}
                className="absolute top-1/2 -translate-y-1/2 w-[2px] h-2 bg-bg pointer-events-none"
                style={{ left: `${(p.start / duration) * 100}%` }}
              />
            ))}
        </div>
        <span className="w-10">{formatTime(duration)}</span>
      </div>

      {/* controls */}
      <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="sm:hidden">
          <VolumeMenu />
        </div>
        <div className="hidden sm:flex items-center gap-3 text-xs text-sub min-w-0">
          <Tip tip="Music volume — the instruments.">
            <label className="flex items-center gap-1.5">
              <Music size={14} className="shrink-0" />
              <input type="range" min={0} max={1} step={0.01} value={s.settings.backingVolume}
                onChange={(e) => studio.updateSettings({ backingVolume: Number(e.target.value) })} className="w-14 sm:w-20" />
            </label>
          </Tip>
          {s.replay ? (
            s.listenSource === 'me' ? (
              <Tip tip="Your voice — how loud your recording plays back.">
                <label className="flex items-center gap-1.5 text-main">
                  <MicVocal size={14} className="shrink-0" />
                  <input type="range" min={0} max={1.5} step={0.01} value={s.settings.voiceVolume}
                    onChange={(e) => studio.updateSettings({ voiceVolume: Number(e.target.value) })} className="w-14 sm:w-20" />
                </label>
              </Tip>
            ) : (
              <Tip tip="Original singer's volume.">
                <label className="flex items-center gap-1.5 text-main">
                  <UserRound size={14} className="shrink-0" />
                  <input type="range" min={0} max={1} step={0.01} value={s.settings.guideVolume}
                    onChange={(e) => studio.updateSettings({ guideVolume: Number(e.target.value) })} className="w-14 sm:w-20" />
                </label>
              </Tip>
            )
          ) : (
            s.caps?.hasGuide && (
              <Tip tip="Original singer's volume — turn it down as you get more confident.">
                <label className="flex items-center gap-1.5">
                  <UserRound size={14} className="shrink-0" />
                  <input type="range" min={0} max={1} step={0.01} value={s.settings.guideVolume}
                    onChange={(e) => studio.updateSettings({ guideVolume: Number(e.target.value) })} className="w-14 sm:w-20" />
                </label>
              </Tip>
            )
          )}
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1">
          <IconToggle tip="Previous phrase (←)" onClick={() => studio.seekPhrase(-1)} disabled={disabled} why="Load a song first.">
            <SkipBack size={18} />
          </IconToggle>
          <span className="hidden sm:inline-flex">
            <IconToggle tip={s.focus ? 'Go to the start of your take' : 'Go to the beginning of the song'} onClick={() => studio.goToBeginning()} disabled={disabled} why="Load a song first.">
              <ChevronFirst size={19} />
            </IconToggle>
          </span>
          <button
            type="button"
            onClick={() => studio.togglePlay()}
            disabled={disabled}
            aria-label="play / pause (space)"
            className="mx-1 w-12 h-12 rounded-full flex items-center justify-center bg-main text-bg hover:brightness-110 active:scale-95 transition-all disabled:opacity-35"
          >
            {s.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
          </button>
          <Tip tip={s.session ? 'End the test and see your results (T)' : s.lastResult ? 'Start a new test from the same spot (T)' : 'Start a test — sing along and get scored (T)'}>
            <button
              type="button"
              onClick={() => studio.toggleTest()}
              disabled={disabled}
              aria-label={s.session ? 'end test' : 'start test'}
              className={cx(
                'mr-1 w-11 h-11 rounded-full flex items-center justify-center ring-1 transition-colors',
                s.session ? 'bg-error/15 text-error ring-error/40 hover:bg-error/25' : 'bg-main-2/10 text-main-2 ring-main-2/35 hover:bg-main-2/20',
              )}
            >
              {s.session ? <Square size={15} fill="currentColor" /> : <Circle size={15} fill="currentColor" />}
            </button>
          </Tip>
          <span className="hidden sm:inline-flex">
            <IconToggle tip="Start a test from the beginning of the song" onClick={() => studio.startTestFromBeginning()}
              disabled={disabled || s.session} why={s.session ? 'End the current test first.' : 'Load a song first.'}>
              <RefreshCcwDot size={18} />
            </IconToggle>
          </span>
          <IconToggle tip="Loop this phrase (L)" preview={PREVIEW.loop} onClick={() => studio.toggleLoop()} active={!!s.loop} disabled={disabled || !s.phrases.length} why="No phrases found in this song.">
            <Repeat size={18} />
          </IconToggle>
          <IconToggle tip="Next phrase (→)" onClick={() => studio.seekPhrase(1)} disabled={disabled} why="Load a song first.">
            <SkipForward size={18} />
          </IconToggle>
        </div>

        <div className="flex items-center justify-end gap-1 text-xs">
          <div className="flex items-center gap-1">
          <Tip tip={s.mic === 'on' ? (s.muted ? 'Mic muted — click to unmute. Right-click to turn the mic off.' : 'Mic on — click to mute, right-click to turn off. (M)') : s.mic === 'starting' ? 'Starting the microphone…' : 'Turn the mic on to see your voice on the graph. Wired headphones work best. (M)'}>
            <button
              type="button"
              onClick={() => (s.mic === 'on' ? studio.toggleMute() : studio.toggleMic())}
              onContextMenu={(e) => {
                e.preventDefault()
                if (s.mic === 'on') studio.toggleMic()
              }}
              aria-label="microphone"
              className={cx(
                'flex items-center justify-center w-11 h-11 rounded-full transition-colors',
                s.mic === 'on' && !s.muted ? 'bg-main text-bg' : 'surface text-text hover:text-main',
              )}
            >
              {s.mic === 'on' && !s.muted ? <Mic size={18} /> : <MicOff size={18} />}
            </button>
          </Tip>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Phones: both volume sliders behind one button. */
function VolumeMenu() {
  const s = useStudio()
  const second = s.replay
    ? s.listenSource === 'me'
      ? { icon: <MicVocal size={14} />, label: 'your voice', max: 1.5, value: s.settings.voiceVolume, set: (v: number) => studio.updateSettings({ voiceVolume: v }) }
      : { icon: <UserRound size={14} />, label: 'original singer', max: 1, value: s.settings.guideVolume, set: (v: number) => studio.updateSettings({ guideVolume: v }) }
    : s.caps?.hasGuide
      ? { icon: <UserRound size={14} />, label: 'original singer', max: 1, value: s.settings.guideVolume, set: (v: number) => studio.updateSettings({ guideVolume: v }) }
      : null
  const row = (icon: ReactNode, label: string, max: number, value: number, set: (v: number) => void) => (
    <label className="flex items-center gap-3 px-2 py-2 text-xs text-sub">
      {icon}
      <span className="w-24 shrink-0">{label}</span>
      <input type="range" min={0} max={max} step={0.01} value={value} onChange={(e) => set(Number(e.target.value))} className="flex-1" />
    </label>
  )
  return (
    <Menu tip="Volume" button={<Volume2 size={18} />} buttonClassName="w-10 h-10 flex items-center justify-center">
      <MenuLabel>volume</MenuLabel>
      {row(<Music size={14} />, 'music', 1, s.settings.backingVolume, (v) => studio.updateSettings({ backingVolume: v }))}
      {second && row(second.icon, second.label, second.max, second.value, second.set)}
    </Menu>
  )
}
