import { useEffect, useState } from 'react'
import { Check, ClipboardPaste, Loader2, PencilLine, RefreshCw } from 'lucide-react'
import { analyzer, type LyricsCandidate } from '../api/analyzer'
import { parseLrc } from '../lib/parsers/lrc'
import { plainTextToLines } from '../lib/phrases'
import { studio } from '../state/studio'
import { Btn, cx, Modal, useStudio } from './ui'

const SOURCE: Record<string, string> = {
  lrclib: 'LRCLIB',
  netease: 'NetEase',
  'youtube captions': 'YouTube captions',
  'youtube auto captions': 'YouTube auto captions',
  'youtube description': 'YouTube description',
  'lyrics.ovh': 'lyrics.ovh',
}

/**
 * "Wrong lyrics?": pick another version that was found, paste your own (they're
 * timed to the singer automatically), or edit line by line. Your choice is kept for
 * this song, on every device.
 */
export function FixLyrics({ onClose, onEditor }: { onClose: () => void; onEditor: () => void }) {
  const s = useStudio()
  const t = s.track
  const [found, setFound] = useState<LyricsCandidate[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [paste, setPaste] = useState('')
  const [tab, setTab] = useState<'found' | 'edit' | 'paste'>(s.lyrics.length ? 'found' : 'paste')
  const [edited, setEdited] = useState(() => s.lyrics.map((l) => l.text).join('\n'))

  useEffect(() => {
    if (!t) return
    const id = t.id
    analyzer
      .lyrics(t.title, t.artist ?? '', t.duration, id.startsWith('yt-') ? id.slice(3) : undefined, id)
      .then((r) => setFound(r.candidates), (e) => setFailed((e as Error).message))
  }, [t])

  if (!t) return null
  const current = s.lyrics.map((l) => l.text).join('\n').trim()
  const textOf = (c: LyricsCandidate) => (c.synced ? parseLrc(c.synced).map((l) => l.text).join('\n') : c.plain ?? '').trim()
  const inUseAt = found ? found.findIndex((c) => textOf(c) === current) : -1
  const use = (c: LyricsCandidate) => {
    studio.setLyrics(c.synced ? parseLrc(c.synced) : plainTextToLines(c.plain ?? ''))
    onClose()
  }
  /** Same number of lines: each keeps its timing (only its words are re-timed inside it). */
  const useEdited = () => {
    const texts = edited.split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
    if (!texts.length) return
    const old = s.lyrics
    const keep = texts.length === old.length && old.some((l) => l.start !== null)
    studio.setLyrics(keep
      ? old.map((l, i) => (l.text === texts[i] ? l : { ...l, text: texts[i], words: undefined, wordsSource: undefined }))
      : plainTextToLines(texts.join('\n')))
    onClose()
  }
  const sameCount = edited.split(/\r?\n/).map((t) => t.trim()).filter(Boolean).length === s.lyrics.length

  const usePaste = () => {
    const text = paste.trim()
    if (!text) return
    studio.setLyrics(/\[\d+:\d+/.test(text) ? parseLrc(text) : plainTextToLines(text))
    onClose()
  }

  return (
    <Modal title="Fix the lyrics" onClose={onClose}>
      <div className="flex gap-1 mb-4 text-xs">
        {([['found', 'Other versions'], ...(s.lyrics.length ? [['edit', 'Edit words']] as const : []), ['paste', 'Paste your own']] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setTab(v)}
            className={cx('px-3 py-1.5 rounded-full', tab === v ? 'bg-main text-bg font-medium' : 'text-sub hover:text-text')}>{label}</button>
        ))}
      </div>

      {tab === 'edit' ? (
        <div>
          <textarea value={edited} onChange={(e) => setEdited(e.target.value)} rows={11} autoFocus
            className="w-full rounded-xl bg-sub-alt border border-line p-3 text-[13px] leading-relaxed text-text outline-none focus:border-main/50 resize-y" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className={cx('text-[11px]', sameCount ? 'text-sub' : 'text-main')}>
              {sameCount ? 'Timing is kept: each line stays where it is.' : 'Lines added or removed: Lemody times them to the singer again.'}
            </span>
            <Btn primary onClick={useEdited} disabled={!edited.trim()}><Check size={13} /> save</Btn>
          </div>
        </div>
      ) : tab === 'found' ? (
        <div className="flex flex-col gap-2">
          {found === null && !failed && (
            <div className="flex items-center gap-2 text-sm text-sub py-6 justify-center"><Loader2 size={15} className="animate-spin" /> searching every source…</div>
          )}
          {failed && <div className="text-sm text-error py-3">Couldn't search: {failed}</div>}
          {found?.length === 0 && <div className="text-sm text-sub py-3">No other versions found. Paste your own instead.</div>}
          {found?.map((c, i) => {
            const text = textOf(c)
            const inUse = i === inUseAt // one version only, even if another has the same words
            const preview = text.split('\n').filter(Boolean).slice(0, 2)
            return (
              <button key={i} type="button" onClick={() => use(c)} disabled={inUse}
                className="text-left rounded-xl border border-line p-3 hover:border-main/60 disabled:border-main/50 disabled:bg-main/5 transition-colors">
                <div className="flex items-center gap-2 text-[11px] text-sub">
                  <span className="text-text font-medium">{SOURCE[c.source] ?? c.source}</span>
                  {c.fits ? <span className="text-main">· matches the song</span>
                    : c.synced && c.fit != null ? <span>· timing doesn’t match</span>
                      : <span>· {c.retimed ? 'words only · timed for you' : 'timed for you'}</span>}
                  {c.duration ? <span>· {Math.floor(c.duration / 60)}:{String(Math.round(c.duration % 60)).padStart(2, '0')}</span> : null}
                  {inUse && <span className="ml-auto flex items-center gap-1 text-main"><Check size={12} /> in use</span>}
                </div>
                {preview.map((ln, k) => <div key={k} className="text-[13px] text-text/90 truncate mt-1">{ln}</div>)}
              </button>
            )
          })}
        </div>
      ) : (
        <div>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={9} autoFocus
            placeholder={'Paste all of the song\u2019s lyrics, one line per line.\nLemody times them to the singer for you.'}
            className="w-full rounded-xl bg-sub-alt border border-line p-3 text-[13px] text-text outline-none focus:border-main/50 resize-y" />
          <div className="mt-3 flex justify-end">
            <Btn primary onClick={usePaste} disabled={!paste.trim()}><ClipboardPaste size={13} /> use my lyrics</Btn>
          </div>
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-line flex flex-wrap gap-2 text-xs">
        <Btn onClick={() => { onClose(); onEditor() }}><PencilLine size={13} /> edit line by line</Btn>
        <Btn onClick={() => { studio.refindLyrics(); onClose() }}><RefreshCw size={13} /> find automatically again</Btn>
      </div>
    </Modal>
  )
}
