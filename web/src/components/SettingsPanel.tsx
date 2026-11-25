import { useEffect, useState } from 'react'
import { studio } from '../state/studio'
import { SFX_PACKS, THEMES, type LineDetail, type MelodyView, type SfxPack, type ThemeMode, type ThemeName } from '../state/persist'
import { sfx } from '../lib/sfx'
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
          <Section title="mode">
            <Choice<ThemeMode> value={st.mode} onChange={(mode) => studio.updateSettings({ mode })}
              options={[{ value: 'dark', label: 'dark' }, { value: 'light', label: 'light' }]} />
          </Section>
          <Section title="theme">
            {/* the quiet ones (one accent on a neutral dark), then the colourful ones (two colours, each from something) */}
            {[THEMES.slice(0, 5), THEMES.slice(5)].map((group, g) => (
              <div key={g} className={cx('w-full', g > 0 && 'mt-3')}>
                <div className="text-[10px] uppercase tracking-[0.12em] text-sub/70 mb-1.5">{g ? 'colourful' : 'calm'}</div>
                <div className="flex flex-wrap gap-2">
                  {group.map((t) => <ThemeSwatch key={t} t={t} on={st.theme === t} mode={st.mode} />)}
                </div>
              </div>
            ))}
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
          <Section title="overall score" hint="the average of the separate scores. it's a practice guide, not a verdict on your voice.">
            <Choice value={st.showOverall ? 'on' : 'off'} onChange={(v) => studio.updateSettings({ showOverall: v === 'on' })}
              options={[{ value: 'on', label: 'show overall' }, { value: 'off', label: 'separate scores only' }]} />
          </Section>
          <Section title="today's top" hint="Your best take of each song goes on today's top if it makes the best 100: your name, photo and result, for other singers to open. You're asked each time whether they may hear your voice too. Takes that drop out are deleted.">
            <Choice value={st.shareTop ? 'on' : 'off'} onChange={(v) => studio.updateSettings({ shareTop: v === 'on' })}
              options={[{ value: 'on', label: 'take part' }, { value: 'off', label: 'don’t take part' }]} />
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
          <Section title="sound effects" hint="little sounds on taps, play / pause, results and notifications. never while a test is recording or the mic hears the song.">
            <Choice value={st.sfx ? 'on' : 'off'} onChange={(v) => studio.updateSettings({ sfx: v === 'on' })}
              options={[{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }]} />
            {st.sfx && (
              <input type="range" min={0.1} max={1} step={0.05} value={st.sfxVolume} aria-label="sound effects volume" className="w-32"
                onChange={(e) => studio.updateSettings({ sfxVolume: Number(e.target.value) })} />
            )}
          </Section>
          {st.sfx && (
            <Section title="sound style" hint="the same sounds, a different feel. tap one to hear it.">
              <Choice value={st.sfxPack} onChange={(sfxPack: SfxPack) => { studio.updateSettings({ sfxPack }); sfx.preview('complete', sfxPack) }}
                options={SFX_PACKS.map((p) => ({ value: p, label: p }))} />
            </Section>
          )}
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

function ThemeSwatch({ t, on, mode }: { t: ThemeName; on: boolean; mode: ThemeMode }) {
  const c = SWATCH[t][mode]
  return (
    <Tip tip={SWATCH[t].mood}>
      <button type="button" onClick={() => studio.updateSettings({ theme: t, themePicked: true })} aria-label={`${t} theme`}
        className={cx('rounded-xl p-1 transition-all', on ? 'ring-grad bg-sub-alt/60' : 'hover:bg-sub-alt/60')}>
        <svg width="56" height="34" viewBox="0 0 56 34" className="rounded-md block border border-line">
          <defs>
            <linearGradient id={`sw-${t}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor={c.main} />
              <stop offset="1" stopColor={c.main2} />
            </linearGradient>
          </defs>
          <rect width="56" height="34" fill={c.bg} />
          <path d="M6 24 C14 24 14 10 22 10 S32 26 40 22 S48 12 50 12" fill="none" stroke={`url(#sw-${t})`} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M6 20 C14 20 16 14 24 14 S34 22 50 16" fill="none" stroke={c.text} strokeOpacity=".45" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="block text-[10px] text-sub mt-1">{t}</span>
      </button>
    </Tip>
  )
}

type Swatch = { bg: string; main: string; main2: string; text: string }
const SWATCH: Record<ThemeName, { mood: string; dark: Swatch; light: Swatch }> = {
  mono: { mood: 'Mono — no colour, just light on charcoal (or ink on paper). The default.', dark: { bg: '#111111', main: '#f0f0f0', main2: '#c4c4c4', text: '#eeeeee' }, light: { bg: '#f2f2f0', main: '#1c1c1c', main2: '#4a4a4a', text: '#161616' } },
  studio: { mood: 'Studio — graphite and brass.', dark: { bg: '#131313', main: '#d8b36f', main2: '#c99a62', text: '#ededea' }, light: { bg: '#f3f2ef', main: '#86601c', main2: '#9a6a3a', text: '#1c1a16' } },
  ink: { mood: 'Ink — blue-black and periwinkle.', dark: { bg: '#111316', main: '#8fb4f6', main2: '#a3a9f2', text: '#e6edf3' }, light: { bg: '#f1f2f4', main: '#2d5cb4', main2: '#5650c0', text: '#141a22' } },
  sage: { mood: 'Sage — green-grey and soft sage.', dark: { bg: '#121413', main: '#a3c9a8', main2: '#8bbcae', text: '#e7ece8' }, light: { bg: '#f1f2f0', main: '#3a7446', main2: '#2c776b', text: '#161c18' } },
  velvet: { mood: 'Velvet — aubergine and dusty rose.', dark: { bg: '#141214', main: '#e3a7b6', main2: '#cfa5d6', text: '#f0e9ee' }, light: { bg: '#f3f1f2', main: '#a23f62', main2: '#84469a', text: '#1f171d' } },
  sunset: { mood: 'Sunset — dusk sky, coral fading into pink.', dark: { bg: '#141212', main: '#ff9e72', main2: '#f2789a', text: '#f4eae5' }, light: { bg: '#f4f2f1', main: '#b94a28', main2: '#b73663', text: '#201815' } },
  ocean: { mood: 'Ocean — deep water, aqua and sea blue.', dark: { bg: '#111415', main: '#5fd6c9', main2: '#5aa9e8', text: '#e2f1f3' }, light: { bg: '#f0f3f3', main: '#0b7069', main2: '#1d5e9e', text: '#10191c' } },
  aurora: { mood: 'Aurora — northern lights, green into violet.', dark: { bg: '#111314', main: '#6ff0b5', main2: '#a194ff', text: '#e4eef2' }, light: { bg: '#f0f3f2', main: '#157a50', main2: '#5b48bc', text: '#121a1c' } },
  ember: { mood: 'Ember — a campfire, amber and flame.', dark: { bg: '#141211', main: '#ffb44d', main2: '#ff7552', text: '#f2e8df' }, light: { bg: '#f4f2ef', main: '#9c560a', main2: '#b83a26', text: '#201811' } },
  sakura: { mood: 'Sakura — cherry blossom at night, pink and lilac.', dark: { bg: '#141213', main: '#ffb3c7', main2: '#c8b6ff', text: '#f5eaee' }, light: { bg: '#f4f1f2', main: '#b03a61', main2: '#644cb8', text: '#22181c' } },
  lavender: { mood: 'Lavender — a field at dusk, violet and orchid.', dark: { bg: '#131216', main: '#b8a3ff', main2: '#ef9fd6', text: '#ece8f5' }, light: { bg: '#f2f1f4', main: '#5d44c2', main2: '#a0347e', text: '#1b1724' } },
  citrus: { mood: 'Citrus — lemon and lime, bright and fresh.', dark: { bg: '#131311', main: '#f2e26a', main2: '#a9e06c', text: '#f0f1e6' }, light: { bg: '#f3f3ef', main: '#6d6000', main2: '#3a7418', text: '#1b1c14' } },
  neon: { mood: 'Neon — a retro arcade, magenta and cyan.', dark: { bg: '#131216', main: '#ff63d4', main2: '#5ff0ff', text: '#f1eafc' }, light: { bg: '#f2f1f4', main: '#b0218c', main2: '#0b7189', text: '#1a1424' } },
  forest: { mood: 'Forest — moss and fireflies, lime and leaf.', dark: { bg: '#121412', main: '#c6e27c', main2: '#7fd093', text: '#e8efe6' }, light: { bg: '#f1f3f0', main: '#506c10', main2: '#2a7444', text: '#151b16' } },
  coffee: { mood: 'Coffee — espresso and cream, caramel and cocoa.', dark: { bg: '#141211', main: '#e0bf9f', main2: '#c4916d', text: '#efe6de' }, light: { bg: '#f4f2ef', main: '#7e5230', main2: '#965834', text: '#1f1814' } },
}
