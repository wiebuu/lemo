import { useEffect, useState } from 'react'
import { DEFAULT_WEIGHTS, METRIC_LABELS } from '../lib/evaluation'
import type { MetricKey } from '../lib/types'
import { studio } from '../state/studio'
import { THEMES, type LineDetail, type MelodyView, type ThemeName } from '../state/persist'
import { WiecodesCredit } from './Credit'
import { go } from '../pages/router'
import { Btn, Choice, cx, Modal, Section, Tabs, Tip, useStudio } from './ui'

type Tab = 'look' | 'scoring' | 'sound'

export function SettingsPanel({ onClose, onCalibrate, onTutorial }: { onClose: () => void; onCalibrate: () => void; onTutorial: () => void }) {
  const s = useStudio()
  const st = s.settings
  const [tab, setTab] = useState<Tab>('look')
  const auto = Math.round(studio.latencySec * 1000)
  // each tab starts at the top
  useEffect(() => {
    document.querySelector('.modal-body')?.scrollTo({ top: 0 })
  }, [tab])

  return (
    <Modal
      title="settings"
      onClose={onClose}
      tabs={
        <Tabs<Tab> value={tab} onChange={setTab}
          options={[{ value: 'look', label: 'look' }, { value: 'scoring', label: 'scoring' }, { value: 'sound', label: 'sound' }]} />
      }
    >
      <div key={tab} className="fade-in">
      {tab === 'look' && (
        <>
          <Section title="theme">
            <div className="flex flex-wrap gap-2">
              {THEMES.map((t) => (
                <Tip key={t} tip={SWATCH[t].mood}>
                  <button type="button" onClick={() => studio.updateSettings({ theme: t, themePicked: true })} aria-label={`${t} theme`}
                    className={cx('rounded-xl p-1 transition-all', st.theme === t ? 'ring-grad bg-sub-alt/60' : 'hover:bg-sub-alt/60')}>
                    <svg width="56" height="34" viewBox="0 0 56 34" className="rounded-md block">
                      <defs>
                        <linearGradient id={`sw-${t}`} x1="0" x2="1" y1="0" y2="0">
                          <stop offset="0" stopColor={SWATCH[t].main} />
                          <stop offset="1" stopColor={SWATCH[t].main2} />
                        </linearGradient>
                      </defs>
                      <rect width="56" height="34" fill={SWATCH[t].bg} />
                      <path d="M6 24 C14 24 14 10 22 10 S32 26 40 22 S48 12 50 12" fill="none" stroke={`url(#sw-${t})`} strokeWidth="2.5" strokeLinecap="round" />
                      <path d="M6 20 C14 20 16 14 24 14 S34 22 50 16" fill="none" stroke={SWATCH[t].text} strokeOpacity=".45" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span className="block text-[10px] text-sub mt-1">{t}</span>
                  </button>
                </Tip>
              ))}
            </div>
          </Section>
          <Section title="original melody" hint="one continuous line to follow, or one block per note.">
            <Choice<MelodyView> value={st.melodyView} onChange={(melodyView) => studio.updateSettings({ melodyView })}
              options={[{ value: 'line', label: 'line' }, { value: 'bars', label: 'blocks' }]} />
          </Section>
          <Section title="line detail" hint="how much the lines are smoothed. scoring is the same either way.">
            <Choice<LineDetail> value={st.lineDetail} onChange={(lineDetail) => studio.updateSettings({ lineDetail })}
              options={[{ value: 'smooth', label: 'smooth' }, { value: 'natural', label: 'natural' }, { value: 'detailed', label: 'detailed' }]} />
          </Section>
          <Section title="graph">
            <Choice value={st.showGrid ? 'on' : 'off'} onChange={(v) => studio.updateSettings({ showGrid: v === 'on' })}
              options={[{ value: 'on', label: 'grid' }, { value: 'off', label: 'no grid' }]} />
            <Choice value={st.showNoteNames ? 'on' : 'off'} onChange={(v) => studio.updateSettings({ showNoteNames: v === 'on' })}
              options={[{ value: 'on', label: 'note names' }, { value: 'off', label: 'no names' }]} />
          </Section>
          <Section title="zoom" hint="or pinch / ⌘-scroll on the graph (⌥-scroll for pitch).">
            <div className="grid grid-cols-[3rem_1fr] items-center gap-x-3 gap-y-2 w-full max-w-sm text-xs text-sub">
              <span>time</span>
              <input type="range" min={40} max={500} value={st.pxPerSec}
                onChange={(e) => studio.updateSettings({ pxPerSec: Number(e.target.value) })} />
              <span>pitch</span>
              <input type="range" min={8} max={40} value={48 - st.semitoneSpan}
                onChange={(e) => studio.updateSettings({ semitoneSpan: 48 - Number(e.target.value) })} />
            </div>
          </Section>
        </>
      )}

      {tab === 'scoring' && (
        <>
          <Section title="mode" hint="melody shape: sing in any key or octave. exact: also checks the original notes.">
            <Choice value={st.scoringMode} onChange={(scoringMode) => studio.updateSettings({ scoringMode })}
              options={[{ value: 'shape', label: 'melody shape' }, { value: 'exact', label: '+ exact notes' }]} />
          </Section>
          <Section title="difficulty" hint="how close counts as on the line — easy: one piano key, normal: half, strict: a quarter.">
            <Choice value={st.toleranceCents} onChange={(v) => studio.updateSettings({ toleranceCents: v })}
              options={[{ value: 100, label: 'easy' }, { value: 50, label: 'normal' }, { value: 25, label: 'strict' }]} />
          </Section>
          <Section title="overall score" hint="a weighted mix of the separate scores. it's a practice guide, not a verdict on your voice.">
            <div className="grid grid-cols-[auto_1fr_2rem] whitespace-nowrap items-center gap-x-3 gap-y-2 text-xs w-full max-w-md">
              {(['shape', 'harmony', 'rhythm', 'tone', 'attack', 'stability', 'dynamics', 'exact'] as MetricKey[]).map((k) => (
                <WeightRow key={k} k={k} value={st.weights[k]} disabled={k === 'exact' && st.scoringMode !== 'exact'} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2 w-full">
              <Choice value={st.showOverall ? 'on' : 'off'} onChange={(v) => studio.updateSettings({ showOverall: v === 'on' })}
                options={[{ value: 'on', label: 'show overall' }, { value: 'off', label: 'separate scores only' }]} />
              <Btn onClick={() => studio.updateSettings({ weights: DEFAULT_WEIGHTS })}>reset mix</Btn>
            </div>
          </Section>
          <Section title="today's top" hint="Your best take of the day goes on today's top if it makes the best 100: your name, photo, result and voice, for other singers to open. Takes that drop out are deleted.">
            <Choice value={st.shareTop ? 'on' : 'off'} onChange={(v) => studio.updateSettings({ shareTop: v === 'on' })}
              options={[{ value: 'on', label: 'share my best take' }, { value: 'off', label: 'don’t share' }]} />
          </Section>
          <Section title="attempt history" hint={s.track ? `${s.attempts.length} attempts saved for this song, in your account.` : 'your recent tries for each song.'}>
            <Choice value={st.showHistory ? 'on' : 'off'} onChange={(v) => studio.updateSettings({ showHistory: v === 'on' })}
              options={[{ value: 'off', label: 'hide' }, { value: 'on', label: 'show on results' }]} />
            {s.track && s.attempts.length > 0 && <Btn onClick={() => studio.clearAttempts()}>clear</Btn>}
          </Section>
        </>
      )}

      {tab === 'sound' && (
        <>
          <Section
            title="latency"
            hint={`lines your voice up with what you hear. ${st.latencyMs === null ? `auto: ${auto} ms.` : `manual: ${st.latencyMs} ms.`} bluetooth usually needs 150–300 ms — calibrate once.`}
          >
            <Btn primary onClick={onCalibrate}>calibrate</Btn>
            <input type="range" min={0} max={400} step={5} value={st.latencyMs ?? auto} className="w-40"
              onChange={(e) => studio.updateSettings({ latencyMs: Number(e.target.value) })} />
            {st.latencyMs !== null && <Btn onClick={() => studio.updateSettings({ latencyMs: null })}>auto</Btn>}
          </Section>
          {s.track && (
            <Section title="melody offset · this song" hint="nudge the melody if it doesn't line up with the audio.">
              <Btn onClick={() => studio.setOffset(s.offsetMs - 50)}>−50</Btn>
              <Btn onClick={() => studio.setOffset(s.offsetMs - 10)}>−10</Btn>
              <span className="text-xs w-16 text-center tabular-nums">{s.offsetMs} ms</span>
              <Btn onClick={() => studio.setOffset(s.offsetMs + 10)}>+10</Btn>
              <Btn onClick={() => studio.setOffset(s.offsetMs + 50)}>+50</Btn>
            </Section>
          )}
          <Section title="your voice" hint="your singing is heard and scored right here on your device — it's never uploaded or recorded. only your last take is kept, in memory, so you can listen back.">
            <a href="/privacy" onClick={go} className="text-xs text-main hover:underline">privacy policy</a>
          </Section>
          <Section title="help">
            <Btn onClick={onTutorial}>show tutorial</Btn>
            <a href="/help" onClick={go} className="text-xs text-main hover:underline ml-1">help & questions</a>
          </Section>
        </>
      )}
      </div>
      <div className="mt-8 pt-4 border-t border-line flex justify-center">
        <WiecodesCredit />
      </div>
    </Modal>
  )
}

function WeightRow({ k, value, disabled }: { k: MetricKey; value: number; disabled: boolean }) {
  const st = studio.snap.settings
  return (
    <>
      <span className={disabled ? 'text-sub/50' : 'text-sub'}>{METRIC_LABELS[k]}</span>
      <input type="range" min={0} max={60} step={5} value={value} disabled={disabled}
        onChange={(e) => studio.updateSettings({ weights: { ...st.weights, [k]: Number(e.target.value) } })} />
      <span className={cx('tabular-nums text-right', disabled ? 'text-sub/50' : 'text-text')}>{value}</span>
    </>
  )
}

const SWATCH: Record<ThemeName, { bg: string; main: string; main2: string; text: string; mood: string }> = {
  studio: { bg: '#131313', main: '#d8b36f', main2: '#c99a62', text: '#ededea', mood: 'Studio — graphite and brass.' },
  ink: { bg: '#0d1117', main: '#8fb4f6', main2: '#a3a9f2', text: '#e6edf3', mood: 'Ink — blue-black and periwinkle.' },
  sage: { bg: '#111412', main: '#a3c9a8', main2: '#8bbcae', text: '#e7ece8', mood: 'Sage — green-grey and soft sage.' },
  velvet: { bg: '#151114', main: '#e3a7b6', main2: '#cfa5d6', text: '#f0e9ee', mood: 'Velvet — aubergine and dusty rose.' },
  mono: { bg: '#111111', main: '#f0f0f0', main2: '#c4c4c4', text: '#eeeeee', mood: 'Mono — no colour, just light on charcoal.' },
}
