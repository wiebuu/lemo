import { useState } from 'react'
import { AudioLines, Ear, Mic } from 'lucide-react'
import { detectOutput, type OutputKind } from '../audio/output'

/**
 * Shown when singing starts without headphones (or when we can't tell). Explains
 * why they matter instead of just asking — the mic must hear only the singer.
 */
export function HeadphoneNote({ kind, onDone }: { kind: Exclude<OutputKind, 'headphones'>; onDone: (wearing: boolean) => void }) {
  const [checking, setChecking] = useState(false)
  const [still, setStill] = useState(false)
  const speaker = kind === 'speaker'

  const confirm = async () => {
    if (!speaker) return onDone(true)
    // we could see the speaker: look again rather than take it on trust
    setChecking(true)
    const now = await detectOutput()
    setChecking(false)
    if (now === 'speaker') setStill(true)
    else onDone(true)
  }

  return (
    <div className="overlay-in fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal aria-labelledby="hp-title">
      <div className="sheet-in modal-in modal-card w-full sm:max-w-md max-h-[94dvh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-3xl shadow-2xl px-6 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Illustration />

        <h2 id="hp-title" className="mt-5 text-xl font-semibold tracking-tight text-text">
          {speaker ? 'The song is playing out loud' : 'Got your headphones on?'}
        </h2>
        <p className="mt-1.5 text-sm text-sub leading-relaxed">
          Lemody listens to you through the mic, so the music needs to go into your ears, not into the room.
        </p>

        <ul className="mt-5 space-y-3.5">
          <Reason icon={<Mic size={15} />} title="The mic hears only you">
            On a speaker the mic also picks up the song and the original singer, and their voice ends up in your line and your score.
          </Reason>
          <Reason icon={<AudioLines size={15} />} title="Your takes sound like you">
            Listening back, you hear your own voice, not a muffled copy of the song.
          </Reason>
          <Reason icon={<Ear size={15} />} title="Notes are easier to match">
            With the melody right in your ears you find the pitch faster, and nobody around you has to hear the track.
          </Reason>
        </ul>

        <p className="mt-5 text-[11px] text-sub leading-relaxed">
          Wired earphones work best. Bluetooth adds a little delay; if your line trails the melody, set it under settings → headphone delay.
        </p>

        {still && (
          <p className="mt-3 text-xs text-error" role="status">
            Sound is still going to the speaker. Connect your headphones and try again.
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2">
          <button type="button" onClick={() => onDone(false)}
            className="h-11 sm:flex-1 rounded-full text-sm text-sub hover:text-text">
            Sing without them
          </button>
          <button type="button" onClick={() => void confirm()} disabled={checking}
            className="h-11 sm:flex-[1.4] rounded-full bg-main text-bg text-sm font-medium hover:brightness-110 active:scale-[.99] disabled:opacity-60">
            {speaker ? (checking ? 'Checking…' : 'I’ve connected them') : 'Yes, I’m wearing them'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Reason({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 w-7 h-7 shrink-0 rounded-full bg-sub-alt text-main flex items-center justify-center">{icon}</span>
      <span className="text-[13px] leading-snug">
        <span className="block text-text font-medium">{title}</span>
        <span className="block text-sub mt-0.5">{children}</span>
      </span>
    </li>
  )
}

/** A phone whose song loops back into its own mic, next to headphones that keep it in your ears. */
function Illustration() {
  return (
    <svg viewBox="0 0 320 120" className="w-full h-auto" aria-hidden>
      {/* left: phone on speaker — sound spills out and curls back into the mic */}
      <rect x="34" y="18" width="52" height="88" rx="10" fill="none" stroke="var(--sub)" strokeWidth="2" />
      <rect x="52" y="24" width="16" height="3" rx="1.5" fill="var(--sub)" opacity=".6" />
      <circle cx="60" cy="98" r="2.5" fill="var(--sub)" opacity=".6" />
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M ${96 + i * 9} ${50 - i * 7} q ${8 + i * 3} ${12 + i * 7} 0 ${24 + i * 14}`} fill="none" stroke="var(--error)" strokeOpacity={0.85 - i * 0.22} strokeWidth="2" strokeLinecap="round" />
      ))}
      <path d="M 118 92 C 118 116, 70 118, 62 104" fill="none" stroke="var(--error)" strokeWidth="1.6" strokeDasharray="3 4" strokeLinecap="round" />
      <path d="M 66 108 l -4 -4 l 5 -2" fill="none" stroke="var(--error)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />

      <line x1="160" y1="26" x2="160" y2="98" stroke="var(--sub)" strokeOpacity=".25" strokeDasharray="2 5" />

      {/* right: headphones — the song stays between your ears */}
      <path d="M 212 74 V 62 a 38 38 0 0 1 76 0 V 74" fill="none" stroke="var(--text)" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="204" y="70" width="16" height="30" rx="7" fill="var(--main)" />
      <rect x="280" y="70" width="16" height="30" rx="7" fill="var(--main)" />
      <path d="M 232 85 q 6 -10 12 0 t 12 0 t 12 0" fill="none" stroke="var(--main)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="250" cy="26" r="9" fill="none" stroke="var(--main)" strokeWidth="1.8" />
      <path d="M 245.5 26 l 3 3 l 6 -6" fill="none" stroke="var(--main)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
