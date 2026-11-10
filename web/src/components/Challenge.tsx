import { Check, Crown } from 'lucide-react'
import { useStudio } from './ui'

/** A friend's link: the score to beat, beside the song's name. After a take: beaten or not. */
export function ChallengeBadge() {
  const s = useStudio()
  if (s.challenge === null) return null
  const score = s.lastResult?.overall.score
  const beat = score != null && score * 100 > s.challenge
  const goal = `${s.challenge.toFixed(2)}%`
  return (
    <span title={beat ? `you beat your friend’s ${goal}` : `your friend’s score to beat: ${goal}`}
      className="shrink-0 inline-flex items-center gap-1 rounded-full bg-main/15 text-main text-[11px] font-medium px-2 py-0.5 tabular-nums whitespace-nowrap">
      {beat ? <Check size={11} /> : <Crown size={11} />}
      {score == null ? `beat ${goal}` : beat ? `you beat ${goal}!` : `${goal} to beat`}
    </span>
  )
}
