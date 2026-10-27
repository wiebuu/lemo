import { useId } from 'react'

/** A small DJ console — two decks and the faders between — in disco colours that flow while the lights are on. */
export function DjIcon({ on, beating, size = 22 }: { on: boolean; /** the steady pulse (while nothing plays; with music, the real kicks drive it) */ beating?: boolean; size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden data-dj-icon
      className={on ? (beating ? 'dj-flow dj-bounce' : 'dj-flow') : 'opacity-80'}>
      <defs>
        <linearGradient id={`dj${id}`} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff4fd8" />
          <stop offset="0.35" stopColor="#8b5cff" />
          <stop offset="0.65" stopColor="#28d7ff" />
          <stop offset="1" stopColor="#ffd23f" />
        </linearGradient>
      </defs>
      <g stroke={`url(#dj${id})`} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="6" width="21" height="12.5" rx="2.5" />
        <circle cx="6.6" cy="12.25" r="3.4" />
        <circle cx="6.6" cy="12.25" r="0.6" fill={`url(#dj${id})`} />
        <circle cx="17.4" cy="12.25" r="3.4" />
        <circle cx="17.4" cy="12.25" r="0.6" fill={`url(#dj${id})`} />
        <path d="M11 9v6.5M13 9v6.5" />
        <path d="M10.3 11.5h1.4M12.3 13.5h1.4" />
      </g>
    </svg>
  )
}
