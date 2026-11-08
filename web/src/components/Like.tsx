import { Heart, X } from 'lucide-react'
import { closeAsk, signInToLike, toggleLike, useLikes } from '../state/library'
import { cx, Tip } from './ui'

/** ♥ on a song: keeps it in your "liked" tab (a guest is asked to sign in first). */
export function LikeButton({ id, size = 14, className }: { id: string; size?: number; className?: string }) {
  const { ids } = useLikes()
  const on = ids.includes(id)
  return (
    <Tip tip={on ? 'Liked · tap to unlike' : 'Like: keep it in your liked songs'}>
      <button type="button" aria-label={on ? 'unlike' : 'like'} aria-pressed={on}
        onClick={(e) => { e.stopPropagation(); void toggleLike(id) }}
        className={cx('p-1 -m-1 rounded-full transition-[color,transform] active:scale-90', on ? 'text-main' : 'text-sub hover:text-text', className)}>
        <Heart size={size} className={cx(on && 'fill-current')} />
      </button>
    </Tip>
  )
}

/** A guest pressed ♥: sign in to keep liked songs. */
export function LikeAsk() {
  const { asking } = useLikes()
  if (!asking) return null
  return (
    <div data-page-dialog className="overlay-in fixed inset-0 z-[85] bg-black/55 backdrop-blur-[2px] flex items-center justify-center px-4"
      onMouseDown={(e) => e.target === e.currentTarget && closeAsk()}>
      <div role="dialog" aria-modal aria-label="sign in to like songs" className="modal-in modal-card relative w-full max-w-sm rounded-2xl shadow-2xl p-5">
        <button type="button" onClick={closeAsk} aria-label="close" className="absolute top-3 right-3 p-1 text-sub hover:text-text"><X size={14} /></button>
        <div className="flex gap-3.5">
          <span className="shrink-0 w-10 h-10 rounded-full bg-sub-alt text-main flex items-center justify-center"><Heart size={17} className="fill-current" /></span>
          <div className="min-w-0 pr-4">
            <div className="text-sm font-semibold text-text">Sign in to like songs</div>
            <p className="mt-1 text-[13px] text-sub leading-relaxed">Your liked songs are kept in your account, on every device you sign in on.</p>
            <div className="mt-3.5 flex items-center gap-3">
              <button type="button" onClick={() => void signInToLike()}
                className="rounded-full bg-main text-bg text-xs font-medium px-4 py-1.5 hover:opacity-90 active:scale-[.98]">sign in with Google</button>
              <button type="button" onClick={closeAsk} className="text-xs text-sub hover:text-text">not now</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
