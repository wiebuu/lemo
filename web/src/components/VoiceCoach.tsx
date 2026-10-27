import { AudioLines, MicOff, Volume2, VolumeX, Waves, Wind } from 'lucide-react'
import { ISSUE_TEXT, type VoiceIssue } from '../lib/voiceCoach'

const ICON: Record<VoiceIssue, typeof MicOff> = {
  muted: MicOff,
  clipping: Volume2,
  silent: VolumeX,
  noisy: Waves,
  'noise-behind': Waves,
  quiet: AudioLines,
  unclear: Wind,
}

/**
 * During a test: what's keeping the mic from hearing you well, and how to fix it.
 * Never blocks anything — taps go straight through to the graph underneath.
 */
export function VoiceCoach({ issue }: { issue: VoiceIssue | null }) {
  if (!issue) return null
  const Icon = ICON[issue]
  const { title, hint } = ISSUE_TEXT[issue]
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center px-3" role="status" aria-live="polite">
      <div key={issue} className="coach-in flex items-start gap-3 max-w-md rounded-2xl modal-card shadow-xl px-4 py-3">
        <span className="mt-0.5 shrink-0 w-8 h-8 rounded-full bg-main/15 text-main flex items-center justify-center">
          <Icon size={16} />
        </span>
        <span className="min-w-0 leading-snug">
          <span className="block text-sm font-semibold text-text">{title}</span>
          <span className="block text-xs text-sub mt-0.5">{hint}</span>
        </span>
      </div>
    </div>
  )
}
