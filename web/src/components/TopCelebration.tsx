import { useEffect, useRef } from 'react'
import { Crown, MicVocal } from 'lucide-react'
import { studio } from '../state/studio'
import { useStudio } from './ui'

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
 * Your take made today's top: confetti, and the choice whether everyone may hear your
 * voice (your score and pitch line are shown either way).
 */
export function TopCelebration() {
  const s = useStudio()
  const top = s.topRank
  const layer = useRef<HTMLDivElement>(null)
  const id = top?.id ?? null
  useEffect(() => {
    if (id && layer.current) burst(layer.current)
  }, [id])
  return (
    <>
      <div ref={layer} className="fixed inset-0 z-[60] pointer-events-none overflow-hidden" aria-hidden />
      {top?.id && (top.voice === 'ask' || top.voice === 'sending') && (
        <div role="dialog" aria-label="You made today's top"
          className="toast-in fixed z-50 left-1/2 -translate-x-1/2 bottom-24 sm:bottom-28 w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-sub-alt shadow-xl px-4 py-3.5 text-center">
          <div className="flex items-center justify-center gap-1.5 text-main font-semibold text-sm sm:text-base">
            <Crown size={16} /> #{top.rank} in today’s top!
          </div>
          <p className="text-[12px] sm:text-xs text-sub mt-1 leading-snug">
            Everyone can see your score and pitch line. Let them hear your voice too?
          </p>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => studio.keepTopVoicePrivate()} disabled={top.voice === 'sending'}
              className="flex-1 rounded-full surface text-text text-xs py-2 disabled:opacity-50">
              no, keep it private
            </button>
            <button type="button" onClick={() => void studio.shareTopVoice()} disabled={top.voice === 'sending'}
              className="flex-1 rounded-full bg-main text-bg text-xs font-medium py-2 flex items-center justify-center gap-1.5 disabled:opacity-70">
              <MicVocal size={13} /> {top.voice === 'sending' ? 'sharing…' : 'share my voice'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
