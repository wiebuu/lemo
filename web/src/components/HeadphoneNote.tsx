import { useEffect } from 'react'
import { Headphones, X } from 'lucide-react'

/**
 * A test started with the sound on the speaker: a short note, nothing to answer, the
 * music keeps going. It goes away by itself (or with ✕).
 */
export function HeadphoneNote({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 7000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div role="status" className="toast-in fixed z-50 left-1/2 -translate-x-1/2 top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] w-[min(24rem,calc(100vw-2rem))] rounded-2xl bg-sub-alt shadow-xl pl-3.5 pr-2 py-2.5 flex items-start gap-3">
      <span className="mt-0.5 w-8 h-8 shrink-0 rounded-full bg-main/15 text-main flex items-center justify-center"><Headphones size={16} /></span>
      <span className="flex-1 min-w-0 text-[12.5px] leading-snug">
        <span className="block text-text font-medium">The song is playing out loud</span>
        <span className="block text-sub mt-0.5">Earphones work best: the mic should hear only you, not the song.</span>
      </span>
      <button type="button" onClick={onClose} aria-label="close" className="w-7 h-7 shrink-0 rounded-full text-sub hover:text-text flex items-center justify-center">
        <X size={15} />
      </button>
    </div>
  )
}
