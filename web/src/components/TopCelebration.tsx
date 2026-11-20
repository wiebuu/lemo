import { useEffect, useRef } from 'react'
import { Crown, Globe, Lock, LogIn, Pause, Play, X } from 'lucide-react'
import { studio } from '../state/studio'
import { cx, Tip, useStudio } from './ui'

const COLORS = ['var(--main)', '#60a5fa', '#f472b6', '#facc15', '#34d399', '#f8fafc']

/** A burst of confetti from both sides of the screen (skipped when the system asks for less motion). */
function burst(layer: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const w = innerWidth
  const h = innerHeight
  const count = w < 640 ? 34 : 60
  for (let i = 0; i < count; i++) {
    const left = i % 2 === 0
    const piece = document.createElement('span')
    const size = 6 + Math.random() * 6
    const round = Math.random() < 0.3
    Object.assign(piece.style, {
      position: 'absolute', top: `${h * (0.55 + Math.random() * 0.2)}px`, left: left ? '-12px' : `${w + 12}px`,
      width: `${size}px`, height: `${round ? size : size * 0.45}px`, borderRadius: round ? '50%' : '1px',
      background: COLORS[i % COLORS.length], willChange: 'transform, opacity',
    })
    layer.appendChild(piece)
    // shot up and inwards from the edge, then falling and fluttering
    const dir = left ? 1 : -1
    const dx = dir * (w * (0.15 + Math.random() * 0.4))
    const up = h * (0.3 + Math.random() * 0.35)
    const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540)
    const time = 1500 + Math.random() * 900
    const a = piece.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.7}px, ${-up}px) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx}px, ${-up + h * 0.45}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: time, delay: Math.random() * 180, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'forwards' },
    )
    a.onfinish = () => piece.remove()
  }
}

/**
 * Your take made today's top: confetti, then a slim bar — your rank, ▶ to hear yourself,
 * and whether everyone may hear your voice (private until you say so; your score and
 * pitch line show either way). Everything saves in the background; ✕ tucks it away
 * (the rank stays in the results line).
 */
export function TopCelebration() {
  const s = useStudio()
  const top = s.topRank
  const layer = useRef<HTMLDivElement>(null)
  const id = top?.id ?? null
  useEffect(() => {
    if (id && layer.current) burst(layer.current)
  }, [id])
  const show = !!top?.id && !top.seen && (top.guest || top.voice !== 'no')
  const hearing = s.playing && s.replay && s.listenSource === 'me'
  return (
    <>
      <div ref={layer} className="fixed inset-0 z-[60] pointer-events-none overflow-hidden" aria-hidden />
      {show && top && (
        <div role="status" aria-label={`#${top.rank} in today's top`}
          className="toast-in fixed z-50 left-1/2 -translate-x-1/2 bottom-24 sm:bottom-28 max-w-[calc(100vw-2rem)] flex items-center gap-1.5 sm:gap-2 rounded-full surface shadow-lg pl-3 pr-1.5 py-1.5 text-xs whitespace-nowrap">
          <Crown size={14} className="text-main shrink-0" />
          <span className="font-medium text-text">#{top.rank} today</span>
          {top.guest ? (
            <>
              <span className="text-sub hidden sm:inline">· as a guest singer</span>
              <Tip tip="Sign in to show your name next time, and keep your scores on any device.">
                <button type="button" onClick={() => void studio.signInFromTop()}
                  className="ml-1 flex items-center gap-1 rounded-full bg-main text-bg font-medium px-2.5 py-1">
                  <LogIn size={12} /> sign in
                </button>
              </Tip>
            </>
          ) : (
            <>
              {s.canReplay && (
                <Tip tip={hearing ? 'Pause' : 'Hear yourself: your voice with the music'}>
                  <button type="button" onClick={() => void studio.hearMyTake()} aria-label={hearing ? 'pause' : 'hear yourself'}
                    className="ml-0.5 flex items-center gap-1 rounded-full bg-sub-alt text-text px-2 py-1 hover:brightness-110">
                    {hearing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                    <span className="hidden sm:inline">hear yourself</span>
                  </button>
                </Tip>
              )}
              <VoiceSwitchPill shared={top.voice === 'shared'} />
            </>
          )}
          <Tip tip="Close (you stay on today's top)">
            <button type="button" onClick={() => studio.skipTop()} aria-label="close"
              className="w-6 h-6 rounded-full flex items-center justify-center text-sub hover:text-text">
              <X size={13} />
            </button>
          </Tip>
        </div>
      )}
    </>
  )
}

/** Private | public: who may hear your voice. Changes at once (saved in the background). */
function VoiceSwitchPill({ shared }: { shared: boolean }) {
  const opt = (pub: boolean, Icon: typeof Lock, label: string, tip: string) => (
    <Tip tip={tip}>
      <button type="button" aria-pressed={shared === pub} onClick={() => studio.setTopVoicePublic(pub)}
        className={cx('relative z-10 w-[4.5rem] flex items-center justify-center gap-1 rounded-full py-0.5 transition-colors', shared === pub ? 'text-bg' : 'text-sub hover:text-text')}>
        <Icon size={11} /> {label}
      </button>
    </Tip>
  )
  return (
    <div className="relative flex items-center bg-bg/60 rounded-full p-0.5">
      <span aria-hidden className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-full bg-main transition-transform duration-300 ease-out"
        style={{ transform: shared ? 'translateX(100%)' : 'translateX(0)' }} />
      {opt(false, Lock, 'private', 'Only you can listen to your voice')}
      {opt(true, Globe, 'public', 'Everyone who opens your take can hear you')}
    </div>
  )
}
