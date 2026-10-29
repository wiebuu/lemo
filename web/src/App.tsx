import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { detectOutput, onOutputChange } from './audio/output'
import { SiteFooter } from './pages/Footer'
import { ConfigBar } from './components/ConfigBar'
import { Graph } from './components/Graph'
import { Header, type Panel } from './components/Header'
import { LiveStats } from './components/LiveStats'
import { LoadPanel } from './components/LoadPanel'
import { Lyrics } from './components/Lyrics'
import { PlayerBar } from './components/PlayerBar'
import { ResultsPanel, VoiceSwitch } from './components/Results'
import { BusyCard, cx, Modal, Tip, usePhone, useStudio } from './components/ui'
import { Keyboard } from 'lucide-react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { studio } from './state/studio'
import { TopCelebration } from './components/TopCelebration'

// Opened now and then: each loads the first time it's needed, not with the app.
const HeadphoneNote = lazy(() => import('./components/HeadphoneNote').then((m) => ({ default: m.HeadphoneNote })))
const Calibration = lazy(() => import('./components/Calibration').then((m) => ({ default: m.Calibration })))
const LyricsEditor = lazy(() => import('./components/LyricsEditor').then((m) => ({ default: m.LyricsEditor })))
const FixLyrics = lazy(() => import('./components/FixLyrics').then((m) => ({ default: m.FixLyrics })))
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const Disco = lazy(() => import('./components/Disco').then((m) => ({ default: m.Disco })))
const Tutorial = lazy(() => import('./components/Tutorial').then((m) => ({ default: m.Tutorial })))

export default function App() {
  const s = useStudio()
  const phone = usePhone()
  const [panel, setPanel] = useState<Panel>(null)
  const headphones = useHeadphoneNotice(s.session)
  const close = useCallback(() => setPanel(null), [])
  const results = !!s.lastResult && !s.session

  useEffect(() => {
    document.documentElement.dataset.theme = s.settings.theme
  }, [s.settings.theme])

  useEffect(() => () => studio.dispose(), [])

  useEffect(() => {
    if (s.track && !s.settings.tutorialDone) {
      setPanel('tutorial')
      studio.updateSettings({ tutorialDone: true })
    }
  }, [s.track, s.settings.tutorialDone])

  useEffect(() => {
    // Keyboard ownership: runs in the capture phase, before any focused element.
    // Only the shortcuts below do anything — a focused button or slider never
    // reacts to space/enter/tab/arrows on its own. Dialogs handle their own keys.
    const SHORTCUTS: Record<string, (e: KeyboardEvent) => void> = {
      ' ': () => studio.togglePlay(),
      tab: () => {
        studio.restartPhrase()
        if (!studio.snap.playing) studio.togglePlay()
      },
      arrowleft: (e) => (e.shiftKey ? studio.seek(studio.heardTime() - 5) : studio.seekPhrase(-1)),
      arrowright: (e) => (e.shiftKey ? studio.seek(studio.heardTime() + 5) : studio.seekPhrase(1)),
      l: () => studio.toggleLoop(),
      m: () => studio.toggleMic(),
      t: () => studio.toggleTest(),
      n: () => studio.snap.mic === 'on' && studio.toggleMute(),
      b: () => studio.addBreath(),
      k: () => studio.toggleMetronome(),
      v: () => studio.toggleListenSource(),
    }
    const SWALLOW = new Set([' ', 'enter', 'tab', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'pageup', 'pagedown'])

    const onKey = (e: KeyboardEvent) => {
      if (panel || location.pathname !== '/') return // a dialog or a site page (About, Help …) is open
      const el = e.target as HTMLElement
      if (el.closest?.('input:not([type=range]), textarea, select, [contenteditable="true"]')) {
        if (e.key === 'Escape') el.blur()
        return // typing in a text field
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return // system combos (zoom is blocked separately)
      const k = e.key.toLowerCase()
      if (k === 'escape') {
        e.preventDefault()
        if (studio.snap.session) return studio.endSession()
        return studio.leaveReview()
      }
      const run = studio.snap.track ? SHORTCUTS[k] : undefined
      if (run || SWALLOW.has(k)) {
        e.preventDefault()
        e.stopPropagation()
        ;(document.activeElement as HTMLElement | null)?.blur?.()
      }
      if (!run) return
      // Holding a key shouldn't flicker play/pause or toggles; only shift+arrow seeking repeats.
      if (e.repeat && !(e.shiftKey && k.startsWith('arrow'))) return
      run(e)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [panel])

  return (
    // The studio fits exactly one screen (no page scrolling): the graph takes the
    // space that's left. The start screen can scroll (long library lists).
    <div className={cx('relative isolate flex flex-col max-w-[1500px] mx-auto px-4 sm:px-10', s.track ? 'h-dvh min-h-[540px] overflow-hidden' : 'h-dvh min-h-[480px] overflow-hidden')}>
      <Header open={setPanel} />

      {s.track ? (
        <main className={cx('flex-1 min-h-0 flex flex-col py-1', phone ? 'gap-1.5' : 'gap-3')}>
          {/* Options only in practice: they fold away during a test and on the results. */}
          <div className="fold" data-closed={s.session || !!s.lastResult}>
            <div><div className="pb-1"><ErrorBoundary label="settings bar"><ConfigBar /></ErrorBoundary></div></div>
          </div>
          <ErrorBoundary label="live readout">
            {/* while singing the big note readout needs the room: the name steps aside */}
            <LiveStats big={s.session} center={phone && !s.session ? (results ? (s.canReplay ? <VoiceSwitch /> : undefined) : (
              // phones: the header has no room for the song's name — it sits in this row, above the graph
              <div className="truncate leading-tight text-[12px]">
                <span className="text-text font-medium">{s.track.title}</span>
                {s.track.artist && <span className="text-sub"> · {s.track.artist}</span>}
              </div>
            )) : undefined} />
          </ErrorBoundary>
          {/* phones: a little air between the song's name and the graph */}
          <div className={cx('flex-1 min-h-0 flex flex-col', phone && 'pt-2')}>
            <ErrorBoundary label="graph"><Graph onImport={() => setPanel('load')} /></ErrorBoundary>
          </div>
          {/* fixed-height slot under the graph: lyrics, or the results panel after a test */}
          <div className={cx('shrink-0 flex flex-col justify-center transition-[height] duration-500',
            phone ? (results ? 'h-[8.5rem] py-1' : 'h-[6rem] py-0.5') : results ? 'h-[10rem] py-4' : 'h-[8rem] py-4')}>
            <ErrorBoundary label="results">
              {results ? <ResultsPanel big={false} /> : <Lyrics onEdit={() => setPanel('lyrics')} onFix={() => setPanel('fixlyrics')} big={s.session} />}
            </ErrorBoundary>
          </div>
        </main>
      ) : (
        <main className="flex-1 min-h-0 flex flex-col py-3 sm:py-6">
          <LoadPanel inline onDone={() => {}} />
        </main>
      )}

      {s.track && <ErrorBoundary label="player"><PlayerBar /></ErrorBoundary>}

      <footer className="flex justify-center text-sub pb-[max(0.4rem,env(safe-area-inset-bottom))] sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[11px] shrink-0">
        {s.track ? (
          <Tip wide tip={
            <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {[['space', 'play / pause'], ['tab', 'try the phrase again'], ['← →', 'previous / next phrase'], ['L', 'loop phrase'], ['M', 'microphone on / off'], ['N', 'mute'], ['B', 'breath mark'], ['K', 'metronome'], ['T', 'start / end a test'], ['V', 'results: hear you / the original'], ['Esc', 'end the test · close the results']].map(([k, v]) => (
                <span key={k} className="contents"><b>{k}</b><span>{v}</span></span>
              ))}
            </span>
          }>
            {/* keyboard shortcuts: only where there's a keyboard (not on phones) */}
            <span className="p-1 hidden [@media(pointer:fine)]:inline-flex"><Keyboard size={15} /></span>
          </Tip>
        ) : (
          <SiteFooter />
        )}
      </footer>

      <TopCelebration />
      {s.toast && (
        <div key={s.toast.id} className="toast-in fixed bottom-28 left-1/2 -translate-x-1/2 z-40 bg-sub-alt text-text text-xs rounded-full px-4 py-2 shadow-lg pointer-events-none">
          {s.toast.text}
        </div>
      )}
      {s.busy && !s.track && (
        <div className="overlay-in fixed inset-0 z-40 flex items-center justify-center bg-bg/70">
          <BusyCard label={s.busy} progress={s.busyProgress} detail={s.busyDetail} />
        </div>
      )}
      <Suspense fallback={null}>
        {headphones.show && <HeadphoneNote onClose={headphones.close} />}
        {s.settings.disco && s.track && !phone && <Disco />}
      </Suspense>
      {(s.error || s.micError) && (
        <button
          type="button"
          onClick={() => studio.clearError()}
          className="fade-in fixed bottom-5 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-sm text-left text-xs bg-sub-alt text-error rounded-md px-4 py-3 z-40"
        >
          {s.error ?? s.micError}
          <span className="block text-sub mt-1">tap to dismiss</span>
        </button>
      )}

      {panel === 'load' && (
        <Modal title="load a song" onClose={close} wide>
          <LoadPanel onDone={close} />
        </Modal>
      )}
      <Suspense fallback={<PanelLoading />}>
      {panel === 'settings' && <SettingsPanel onClose={close} onCalibrate={() => setPanel('calibrate')} onTutorial={() => setPanel('tutorial')} />}
      {panel === 'lyrics' && s.track && <LyricsEditor onClose={close} />}
      {panel === 'fixlyrics' && s.track && <FixLyrics onClose={close} onEditor={() => setPanel('lyrics')} />}
      {panel === 'tutorial' && <Tutorial onClose={close} />}
      {panel === 'calibrate' && <Calibration onClose={() => setPanel('settings')} />}
      </Suspense>
    </div>
  )
}

/** Once per visit: has the first test checked where the sound goes? */
let outputChecked = false

/**
 * The first test after opening the site: if the sound is going to the speaker, a short
 * note says earphones work best. Nothing to answer, the music keeps playing, and it's
 * not shown again this visit. Phones that don't say where the sound goes (iPhones)
 * get no note rather than a guess.
 */
function useHeadphoneNotice(session: boolean) {
  const [show, setShow] = useState(false)
  const close = useCallback(() => setShow(false), [])

  useEffect(() => {
    if (!session || outputChecked) return
    outputChecked = true
    let live = true
    void detectOutput().then((kind) => live && kind === 'speaker' && setShow(true))
    return () => {
      live = false
    }
  }, [session])

  // earphones plugged in while it shows → it goes away
  useEffect(
    () => (show ? onOutputChange(() => void detectOutput().then((kind) => kind === 'headphones' && setShow(false))) : undefined),
    [show],
  )

  return { show, close }
}

/** While a window's code arrives (first open only, a moment): a small spinner, no jump. */
function PanelLoading() {
  return (
    <div className="overlay-in fixed inset-0 z-50 bg-black/40 flex items-center justify-center" role="status" aria-label="loading">
      <span className="eq"><span /><span /><span /></span>
    </div>
  )
}
