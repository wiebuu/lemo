import { useEffect, useRef, useState } from 'react'
import { median } from '../lib/music'
import { studio } from '../state/studio'
import { Btn, Kbd, Modal } from './ui'

const CLICKS = 8
const INTERVAL = 0.6

/**
 * Tap-along latency calibration: we schedule clicks at exact AudioContext
 * times; you tap along. The median delay = output latency (incl. Bluetooth)
 * plus your reaction, which is the same delay that affects singing along.
 */
export function Calibration({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [result, setResult] = useState<number | null>(null)
  const [count, setCount] = useState(0)
  const clicks = useRef<number[]>([])
  const taps = useRef<number[]>([])

  const start = async () => {
    const ctx = studio.audioContext
    await ctx.resume()
    const t0 = ctx.currentTime + 1
    clicks.current = Array.from({ length: CLICKS }, (_, i) => t0 + i * INTERVAL)
    clicks.current.forEach((t) => studio.playClick(t))
    taps.current = []
    setCount(0)
    setPhase('running')
    setTimeout(finish, (1 + CLICKS * INTERVAL + 0.6) * 1000)
  }

  const tap = (eventTimeStamp: number) => {
    if (phase !== 'running') return
    const ctx = studio.audioContext
    const ageSec = (performance.now() - eventTimeStamp) / 1000
    taps.current.push(ctx.currentTime - ageSec)
    setCount((c) => c + 1)
  }

  const finish = () => {
    const offsets: number[] = []
    for (const t of taps.current) {
      const nearest = clicks.current.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a))
      const d = t - nearest
      if (d > -0.15 && d < 0.45) offsets.push(d)
    }
    setResult(offsets.length >= 4 ? Math.round(median(offsets) * 1000) : null)
    setPhase('done')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) tap(e.timeStamp)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <Modal title="latency calibration" onClose={onClose}>
      <p className="text-sm text-sub leading-relaxed">
        put on the headphones you'll sing with. you'll hear {CLICKS} clicks — tap <Kbd>space</Kbd> exactly on each one.
      </p>
      <div className="my-8 flex flex-col items-center gap-3">
        {phase === 'running' && (
          <button type="button" onPointerDown={(e) => tap(e.timeStamp)} className="w-28 h-28 rounded-full bg-sub-alt text-main text-3xl tabular-nums active:bg-main active:text-bg">
            {count}
          </button>
        )}
        {phase === 'idle' && <Btn primary onClick={start}>start</Btn>}
        {phase === 'done' &&
          (result === null ? (
            <div className="text-sm text-error">not enough taps landed near the clicks — try again.</div>
          ) : (
            <div className="text-center">
              <div className="text-sub text-sm">measured delay</div>
              <div className="text-main text-5xl tabular-nums">{result}ms</div>
            </div>
          ))}
      </div>
      {phase === 'done' && (
        <div className="flex gap-2 justify-center">
          <Btn onClick={start}>again</Btn>
          {result !== null && (
            <Btn primary onClick={() => { studio.updateSettings({ latencyMs: Math.max(0, result) }); onClose() }}>
              use {Math.max(0, result)}ms
            </Btn>
          )}
        </div>
      )}
    </Modal>
  )
}
