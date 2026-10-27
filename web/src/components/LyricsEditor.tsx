import { useEffect, useRef, useState } from 'react'
import { Clock, Loader2, Trash2 } from 'lucide-react'
import { analyzer, type LyricsCandidate } from '../api/analyzer'
import { formatTime } from '../lib/music'
import { parseLrc, toLrc } from '../lib/parsers/lrc'
import { plainTextToLines } from '../lib/phrases'
import type { LyricLine } from '../lib/types'
import { studio } from '../state/studio'
import { Btn, cx, Kbd, Modal, useStudio } from './ui'

const fmt = (t: number | null) => (t === null ? '' : `${formatTime(t)}.${String(Math.floor((t % 1) * 100)).padStart(2, '0')}`)
function parseT(v: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(v)
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : null
}

export function LyricsEditor({ onClose }: { onClose: () => void }) {
  const s = useStudio()
  const [lines, setLines] = useState<LyricLine[]>(() => s.lyrics.map((l) => ({ ...l })))
  const [paste, setPaste] = useState<string | null>(null)
  const [tap, setTap] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const [query, setQuery] = useState({ title: s.track?.title ?? '', artist: s.track?.artist ?? '' })
  const fileInput = useRef<HTMLInputElement>(null)
  const dirty = useRef(false)

  const update = (next: LyricLine[]) => {
    dirty.current = true
    setLines(next)
  }

  // Tap-sync: space/enter stamps the current line with the playhead time.
  useEffect(() => {
    if (!tap) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      e.stopPropagation()
      const t = Math.round(studio.heardTime() * 100) / 100
      setLines((ls) => {
        if (cursor >= ls.length) return ls
        const next = ls.map((l, i) => (i === cursor ? { ...l, start: t, words: undefined, verified: true } : l))
        dirty.current = true
        return next
      })
      setCursor((c) => c + 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tap, cursor])

  const save = () => {
    const sorted = [...lines]
    for (let i = 0; i < sorted.length; i++) {
      const nextStart = sorted.slice(i + 1).find((l) => l.start !== null)?.start ?? null
      if (sorted[i].start !== null) sorted[i] = { ...sorted[i], end: nextStart ?? sorted[i].start! + 5 }
    }
    studio.setLyrics(sorted)
    dirty.current = false
    setMsg('saved')
  }

  const close = () => {
    if (dirty.current) save()
    onClose()
  }

  const [found, setFound] = useState<LyricsCandidate[]>([])

  const use = (c: LyricsCandidate) => {
    if (c.synced) {
      update(parseLrc(c.synced))
      setMsg(`using ${c.source}: ${c.match ?? ''}. timings are unverified — check them while playing.`)
    } else if (c.plain) {
      update(plainTextToLines(c.plain))
      setMsg(`using ${c.source}: no timing — use tap-sync.`)
    }
  }

  const [searching, setSearching] = useState(false)
  const findLyrics = async () => {
    setMsg('searching lrclib, netease, youtube captions, lyrics.ovh…')
    setFound([])
    setSearching(true)
    try {
      const id = s.track?.id ?? ''
      const r = await analyzer.lyrics(query.title, query.artist, s.track?.duration ?? 0, id.startsWith('yt-') ? id.slice(3) : undefined, id || undefined)
      setFound(r.candidates)
      if (r.candidates.length) use(r.candidates[0])
      else setMsg(`no lyrics found${r.failedSources.length ? ` (${r.failedSources.join(', ')} didn't answer)` : ''}. try editing the title / artist.`)
    } catch (e) {
      setMsg(`lyrics lookup failed: ${(e as Error).message}`)
    } finally {
      setSearching(false)
    }
  }

  const exportLrc = () => {
    const blob = new Blob([toLrc(lines)], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${s.track?.title ?? 'lyrics'}.lrc`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <Modal title="lyrics & breath marks" onClose={close} wide>
      <div className="flex flex-wrap gap-2 mb-4">
        <Btn onClick={() => setPaste(paste === null ? lines.map((l) => l.text).join('\n') : null)}>paste / edit text</Btn>
        <Btn onClick={() => fileInput.current?.click()}>import .lrc / .txt</Btn>
        <Btn onClick={exportLrc} disabled={!lines.length}>export .lrc</Btn>
        <Btn onClick={() => { studio.resetLyrics(); setLines(studio.snap.lyrics.map((l) => ({ ...l }))); dirty.current = false }}>reset to source</Btn>
        <input ref={fileInput} type="file" accept=".lrc,.txt" hidden onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          const text = await f.text()
          update(/\[\d+:\d+/.test(text) ? parseLrc(text) : plainTextToLines(text))
        }} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <input value={query.title} onChange={(e) => setQuery({ ...query, title: e.target.value })} placeholder="title"
          className="bg-sub-alt rounded-md px-2 py-1.5 outline-none text-text w-40" />
        <input value={query.artist} onChange={(e) => setQuery({ ...query, artist: e.target.value })} placeholder="artist"
          className="bg-sub-alt rounded-md px-2 py-1.5 outline-none text-text w-32" />
        <Btn onClick={findLyrics} disabled={!query.title || searching}>
          {searching && <Loader2 size={12} className="animate-spin" />}
          {searching ? 'searching…' : 'find lyrics'}
        </Btn>
        <span className="text-sub">searches several free lyrics sources — for personal practice.</span>
      </div>
      {found.length > 1 && (
        <div className="mb-4 -mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <span className="text-sub self-center mr-1">other versions:</span>
          {found.map((c, i) => (
            <button key={i} type="button" onClick={() => use(c)} title={c.match ?? ''}
              className="surface rounded-full px-2.5 py-1 text-sub hover:text-text max-w-[16rem] truncate">
              {c.source} · {c.script === 'deva' ? 'हिंदी' : c.script === 'urdu' ? 'اردو' : 'abc'} · {c.synced ? 'synced' : 'no timing'}
              {c.duration ? ` · ${Math.floor(c.duration / 60)}:${String(Math.round(c.duration % 60)).padStart(2, '0')}` : ''}
            </button>
          ))}
        </div>
      )}

      {paste !== null ? (
        <div>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={12} placeholder="one lyric line per row"
            className="w-full bg-sub-alt rounded-md p-3 text-sm outline-none text-text" />
          <div className="flex gap-2 mt-2">
            <Btn primary onClick={() => { update(plainTextToLines(paste)); setPaste(null); setCursor(0) }}>use these lines (untimed)</Btn>
            <Btn onClick={() => setPaste(null)}>cancel</Btn>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
            <Btn primary={tap} onClick={() => { setTap(!tap); setCursor(lines.findIndex((l) => l.start === null) >= 0 ? lines.findIndex((l) => l.start === null) : 0) }}>
              {tap ? 'stop tap-sync' : 'tap-sync'}
            </Btn>
            {tap ? (
              <span className="text-sub">
                play the song and press <Kbd>space</Kbd> / <Kbd>enter</Kbd> as each highlighted line starts.
                <Btn className="ml-2" onClick={() => studio.togglePlay()}>{s.playing ? 'pause' : 'play'}</Btn>
              </span>
            ) : (
              <span className="text-sub">times are m:ss.cc · ✓ = verified by you, ~ = estimated / imported</span>
            )}
          </div>
          <div className="max-h-[42vh] overflow-y-auto pr-1">
            {lines.length === 0 && <div className="text-sub text-sm py-6 text-center">no lyrics yet — paste, import, or find lyrics.</div>}
            {lines.map((l, i) => (
              <div key={l.id} className={cx('flex items-center gap-2 py-1 text-sm', tap && i === cursor && 'bg-sub-alt rounded-md')}>
                <span className={cx('w-3 text-xs', l.verified ? 'text-main' : 'text-sub')} title={l.verified ? 'verified' : 'unverified timing'}>
                  {l.start === null ? '' : l.verified ? '✓' : '~'}
                </span>
                <input
                  defaultValue={fmt(l.start)}
                  key={`${l.id}-${l.start}`}
                  placeholder="—"
                  onBlur={(e) => {
                    const t = e.target.value.trim() ? parseT(e.target.value) : null
                    update(lines.map((x, k) => (k === i ? { ...x, start: t, words: undefined, verified: t !== null } : x)))
                  }}
                  className="w-20 bg-transparent text-sub focus:text-text outline-none tabular-nums text-xs"
                />
                <button type="button" title="set to current playhead" className="text-sub hover:text-main"
                  onClick={() => update(lines.map((x, k) => (k === i ? { ...x, start: Math.round(studio.heardTime() * 100) / 100, words: undefined, verified: true } : x)))}>
                  <Clock size={13} />
                </button>
                <input
                  value={l.text}
                  onChange={(e) => update(lines.map((x, k) => (k === i ? { ...x, text: e.target.value, words: undefined } : x)))}
                  className="flex-1 min-w-0 bg-transparent text-text outline-none focus:bg-sub-alt rounded px-1"
                />
                <button type="button" title="seek here" disabled={l.start === null} className="text-xs text-sub hover:text-text disabled:opacity-0"
                  onClick={() => l.start !== null && studio.seek(Math.max(0, l.start - 1))}>
                  ▸
                </button>
                <button type="button" title="delete line" className="text-sub hover:text-error" onClick={() => update(lines.filter((_, k) => k !== i))}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <Btn onClick={() => update([...lines, { id: `n${Date.now().toString(36)}`, start: null, end: null, text: '', verified: false }])}>add line</Btn>
            <Btn primary onClick={save}>save</Btn>
            {msg && <span className="text-xs text-sub self-center">{msg}</span>}
          </div>
        </>
      )}

      <div className="mt-8">
        <div className="text-sm text-text mb-1">breath marks</div>
        <div className="text-xs text-sub mb-3">
          press <Kbd>b</Kbd> while playing to add one. filled = yours, hollow = suggested from gaps between phrases.
        </div>
        <div className="flex flex-wrap gap-2">
          {s.breaths.length === 0 && <span className="text-xs text-sub">none yet</span>}
          {s.breaths.map((b) => (
            <span key={b.id} className={cx('text-xs rounded-md px-2 py-1 flex items-center gap-2', b.kind === 'manual' ? 'bg-sub-alt text-main' : 'border border-sub-alt text-sub')}>
              {b.kind === 'manual' ? '▼' : '▽'} {fmt(b.time)}
              {b.kind === 'manual' ? (
                <button type="button" className="hover:text-error" onClick={() => studio.removeBreath(b.id)}>×</button>
              ) : (
                <button type="button" className="hover:text-text" title="confirm this suggestion" onClick={() => studio.confirmBreath(b)}>keep</button>
              )}
            </span>
          ))}
        </div>
      </div>
    </Modal>
  )
}
