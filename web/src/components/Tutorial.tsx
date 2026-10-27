import { useState } from 'react'
import { Btn, Modal } from './ui'

const STEPS: { title: string; body: string; demo: React.ReactNode }[] = [
  {
    title: 'the graph',
    body: 'time scrolls right-to-left past the playhead in the middle. higher on the graph = higher pitch. note names are on the left.',
    demo: <Svg><line x1="120" y1="0" x2="120" y2="70" stroke="var(--main)" strokeOpacity=".5" strokeWidth="2" /><text x="4" y="22" fill="var(--sub)" fontSize="9">E4</text><text x="4" y="52" fill="var(--sub)" fontSize="9">C4</text></Svg>,
  },
  {
    title: 'target notes',
    body: 'grey pills are the melody you should sing, with the lyric syllable above. the one under the playhead lights up.',
    demo: <Svg><rect x="30" y="40" width="60" height="9" rx="4.5" fill="var(--sub)" /><rect x="100" y="25" width="70" height="9" rx="4.5" fill="var(--text)" /><rect x="180" y="32" width="40" height="9" rx="4.5" fill="var(--sub)" /></Svg>,
  },
  {
    title: 'your voice',
    body: 'turn on the mic and sing — your voice is the coloured line. sing in whatever key or octave suits you: in melody-shape mode your line is shifted into the song\'s key, so only the shape of the melody counts.',
    demo: <Svg><rect x="30" y="31" width="160" height="9" rx="4.5" fill="var(--sub)" fillOpacity=".55" /><path d="M30 46 C60 40 70 36 90 35 S150 36 190 35" stroke="var(--main)" strokeWidth="3" fill="none" strokeLinecap="round" /></Svg>,
  },
  {
    title: 'higher, lower, softer',
    body: 'orange = go lower, blue = go higher (relative to your own key), with how far off in cents — 100¢ is one semitone. the lane at the bottom compares your loudness to the original, relative to yourself — mic volume doesn\'t matter.',
    demo: <Svg><rect x="30" y="31" width="160" height="9" rx="4.5" fill="var(--sub)" fillOpacity=".55" /><path d="M30 22 L100 22" stroke="var(--sharp)" strokeWidth="3" strokeLinecap="round" /><path d="M110 50 L190 50" stroke="var(--flat)" strokeWidth="3" strokeLinecap="round" /><text x="60" y="15" fill="var(--sharp)" fontSize="9">+40¢</text><text x="140" y="64" fill="var(--flat)" fontSize="9">−35¢</text></Svg>,
  },
  {
    title: 'practise',
    body: 'loop a phrase (l), sing it a few times, and compare the separate scores — melody shape, rhythm, stability and dynamics — after each pass. use wired headphones so the song doesn\'t leak into the mic.',
    demo: <Svg><rect x="60" y="0" width="120" height="70" fill="var(--sub-alt)" /><rect x="59" y="0" width="2" height="70" fill="var(--main)" fillOpacity=".5" /><rect x="179" y="0" width="2" height="70" fill="var(--main)" fillOpacity=".5" /><text x="98" y="40" fill="var(--main)" fontSize="14">82%</text></Svg>,
  },
]

function Svg({ children }: { children: React.ReactNode }) {
  return <svg viewBox="0 0 240 70" className="w-full h-24 bg-bg rounded-md">{children}</svg>
}

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  const step = STEPS[i]
  return (
    <Modal title={`how Lemody works · ${i + 1}/${STEPS.length}`} onClose={onClose}>
      {step.demo}
      <div className="text-text text-lg mt-5">{step.title}</div>
      <p className="text-sub text-sm mt-2 leading-relaxed min-h-[4rem]">{step.body}</p>
      <div className="flex justify-between mt-4">
        <Btn onClick={() => setI(i - 1)} disabled={i === 0}>back</Btn>
        {i < STEPS.length - 1 ? <Btn primary onClick={() => setI(i + 1)}>next</Btn> : <Btn primary onClick={onClose}>start singing</Btn>}
      </div>
    </Modal>
  )
}
