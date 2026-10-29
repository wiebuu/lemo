import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Laptop, Link2, Play, Plus, Upload, X } from 'lucide-react'
import { analyzer, type RequestBoard } from '../api/analyzer'
import { useAuth } from '../auth/firebase'
import { songLink } from '../lib/songLinks'
import { tidyTitle } from '../lib/titles'
import { studio } from '../state/studio'
import { cx } from '../components/ui'
import { navigate } from './router'

const DeviceRun = lazy(() => import('../components/DeviceAnalysis').then((m) => ({ default: m.DeviceRun })))

function ago(at: number): string {
  const s = Math.max(0, Date.now() / 1000 - at)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86400)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** "Alice", "Alice and Bob", "Alice, Bob and 3 others" — first names only. */
function who(names: string[]): string {
  const first = names.map((n) => n.trim().split(/\s+/)[0] || 'a singer')
  if (first.length <= 2) return first.join(' and ')
  return `${first.slice(0, 2).join(', ')} and ${first.length - 2} ${first.length === 3 ? 'other' : 'others'}`
}

function site(url: string): string {
  const l = songLink(url)
  if (l?.kind === 'youtube') return 'YouTube'
  if (l?.kind === 'locked') return l.site
  if (l?.kind === 'file') return l.from
  return 'a link'
}

/**
 * Coming soon: every song people asked Lemody to add, who asked and when — and the ones
 * added this week. Anyone whose device can analyse songs can add one for everyone now:
 * the link itself when it's a song file (Drive, Dropbox …), otherwise their own copy.
 */
export function ComingPage() {
  const auth = useAuth()
  const [board, setBoard] = useState<RequestBoard | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [device, setDevice] = useState<{ ok: boolean; why?: string } | null>(null)
  const [running, setRunning] = useState<{ songId: string; src: string | File } | null>(null)
  const [thanks, setThanks] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  const picking = useRef<string | null>(null)

  const load = useCallback(() => analyzer.allRequests().then(setBoard, (e: Error) => setErr(e.message)), [])
  const signedIn = auth.status === 'signed-in'
  useEffect(() => {
    if (signedIn) void load()
  }, [signedIn, load])
  useEffect(() => void import('../analysis/onDevice').then((m) => m.deviceSupport()).then(setDevice, () => {}), [])

  const done = async (songId: string, title: string, target: string) => {
    setRunning(null)
    try {
      await analyzer.fulfilRequest(songId, target)
      setThanks(title)
    } catch (e) {
      setErr((e as Error).message)
    }
    void load()
  }

  if (auth.status === 'signed-out') return <p className="card">Sign in on the home page to see this.</p>

  return (
    <>
      <p className="lead">Songs people asked Lemody to add. They’re added within a week — or right now, if you help.</p>
      <button type="button" onClick={() => setAsking(true)}
        className="not-prose mb-4 rounded-full bg-main text-bg text-[13px] font-medium px-4 py-2 inline-flex items-center gap-1.5">
        <Plus size={14} /> ask for a song
      </button>
      {asking && <AskDialog onClose={() => setAsking(false)} onAsked={() => void load()} />}
      <p>
        <Laptop size={14} className="inline -mt-0.5 mr-1 text-main" />
        Got a good laptop or computer? Analyse a song on it and it’s added for everyone who asked.
        Song-file links are analysed straight from the link; for YouTube, Spotify and the rest, use your own copy of the song.
      </p>
      {err && <p className="card">{err}</p>}
      {thanks && (
        <div className="card">
          <div className="card-title">Thank you! 🎉</div>
          <p><b>{thanks}</b> is in Lemody now, and in the song list of everyone who asked for it.</p>
        </div>
      )}
      {!board && !err && <p className="text-sub">loading…</p>}

      <input ref={pick} type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac" hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f && picking.current) setRunning({ songId: picking.current, src: f })
        }} />

      {board && (
        <>
          <h2>Waiting · {board.pending.length}</h2>
          {board.pending.length === 0 && (
            <p>Nothing waiting — every song asked for is in. <a href="#ask" onClick={(e) => { e.preventDefault(); setAsking(true) }}>Ask for one</a>.</p>
          )}
          <ul className="not-prose border-t border-line" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {board.pending.map((r) => {
              const t = tidyTitle(r.title ?? '', r.artist ?? '')
              const fileLink = songLink(r.url)?.kind === 'file'
              const here = running?.songId === r.songId
              return (
                <li key={r.songId} className="border-b border-line py-2.5" style={{ margin: 0, padding: undefined }}>
                  <div className="flex items-center gap-3">
                    <span className="flex-1 min-w-0 leading-tight">
                      <span className="block text-text truncate text-[13px] sm:text-[15px]">
                        {t.title || site(r.url)}{t.artist && <span className="text-sub"> · {t.artist}</span>}
                      </span>
                      <span className="block text-[11px] sm:text-xs text-sub truncate">
                        asked by {who(r.names)}{r.mine && <span className="text-main"> (you)</span>} · {ago(r.firstAt)} · {' '}
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5">{site(r.url)} <ExternalLink size={10} /></a>
                      </span>
                    </span>
                    {device?.ok && !here && (
                      <button type="button" disabled={!!running}
                        onClick={() => {
                          setThanks(null)
                          if (fileLink) setRunning({ songId: r.songId, src: r.url })
                          else {
                            picking.current = r.songId
                            pick.current?.click()
                          }
                        }}
                        className={cx('shrink-0 rounded-full text-[11px] sm:text-xs font-medium px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40',
                          fileLink ? 'bg-main text-bg' : 'bg-main/15 text-main hover:bg-main/25')}>
                        {fileLink ? <><Play size={11} className="fill-current" /> analyse it</> : <><Upload size={11} /> use my copy</>}
                      </button>
                    )}
                  </div>
                  {here && running && (
                    <Suspense fallback={<p className="text-sub text-xs mt-2">starting…</p>}>
                      <DeviceRun url={running.src} serverSec={300}
                        onDone={(id) => void done(r.songId, t.title || 'The song', id)}
                        onCancel={() => setRunning(null)} />
                    </Suspense>
                  )}
                </li>
              )
            })}
          </ul>
          {device && !device.ok && board.pending.length > 0 && (
            <p className="mt-3 text-xs">This device can’t analyse songs{device.why ? ` (${device.why})` : ''} — open this page on a computer to help.</p>
          )}

          {board.added.length > 0 && (
            <>
              <h2>Added this week · {board.added.length}</h2>
              <ul className="not-prose border-t border-line" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {board.added.map((r) => {
                  const t = tidyTitle(r.title ?? '', r.artist ?? '')
                  return (
                    <li key={r.songId} className="border-b border-line py-2.5 flex items-center gap-3" style={{ margin: 0 }}>
                      <span className="flex-1 min-w-0 leading-tight">
                        <span className="block text-text truncate text-[13px] sm:text-[15px]">{t.title || 'a song'}{t.artist && <span className="text-sub"> · {t.artist}</span>}</span>
                        <span className="block text-[11px] sm:text-xs text-sub truncate">
                          asked by {who(r.names)} · added {ago(r.doneAt)}{r.helper ? ` by ${who([r.helper])} 💛` : ''}
                        </span>
                      </span>
                      {r.target && (
                        <button type="button" onClick={() => { navigate('/'); void studio.loadAnalyzed(r.target!) }}
                          className="shrink-0 rounded-full surface text-text text-[11px] sm:text-xs px-3 py-1.5 flex items-center gap-1.5">
                          <Play size={11} className="text-main fill-current" /> sing
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <p className="mt-6">Want a song that isn’t here? <a href="#ask" onClick={(e) => { e.preventDefault(); setAsking(true) }}>Paste its link</a>.</p>
        </>
      )}
    </>
  )
}

/** Paste a link to a song (YouTube, Spotify, …): it joins the list, and it's in your songs once added. */
export function AskDialog({ onClose, onAsked }: { onClose: () => void; onAsked: () => void }) {
  const [url, setUrl] = useState('')
  const [state, setState] = useState<{ kind: 'idle' | 'sending' } | { kind: 'done'; title: string } | { kind: 'ready'; id: string } | { kind: 'error'; message: string }>({ kind: 'idle' })
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const link = songLink(url)
  const send = async () => {
    if (!link) return setState({ kind: 'error', message: 'That doesn’t look like a link — copy it from the share button of YouTube, Spotify or wherever the song is.' })
    setState({ kind: 'sending' })
    try {
      const r = await analyzer.requestSong(url.trim())
      if (r.state === 'ready') setState({ kind: 'ready', id: r.id })
      else {
        setState({ kind: 'done', title: r.title || 'the song' })
        onAsked()
      }
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message })
    }
  }
  return (
    <div data-page-dialog className="overlay-in fixed inset-0 z-[80] bg-black/55 flex items-end sm:items-center justify-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-labelledby="ask-title"
        className="not-prose modal-in sheet-in modal-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-3">
          <h3 id="ask-title" className="text-text text-base font-semibold tracking-tight">Ask for a song</h3>
          <button type="button" onClick={onClose} aria-label="close" className="w-8 h-8 rounded-full text-sub hover:text-text flex items-center justify-center"><X size={16} /></button>
        </div>
        {state.kind === 'done' ? (
          <>
            <p className="mt-2 text-[13px] text-sub leading-relaxed">
              <span className="text-text font-medium">Got it.</span> <span className="text-text">{state.title}</span> is on the list. It’s added within a week —
              then it’s in your songs, and everyone can sing it.
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => { setUrl(''); setState({ kind: 'idle' }) }} className="flex-1 h-10 rounded-full surface text-text text-[13px]">ask for another</button>
              <button type="button" onClick={onClose} className="flex-1 h-10 rounded-full bg-main text-bg text-[13px] font-medium">done</button>
            </div>
          </>
        ) : state.kind === 'ready' ? (
          <>
            <p className="mt-2 text-[13px] text-sub leading-relaxed"><span className="text-text font-medium">Good news:</span> this song is already in Lemody.</p>
            <button type="button" onClick={() => { onClose(); navigate('/'); void studio.loadAnalyzed(state.id) }}
              className="mt-4 w-full h-10 rounded-full bg-main text-bg text-[13px] font-medium flex items-center justify-center gap-1.5">
              <Play size={12} className="fill-current" /> sing it now
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-[12.5px] text-sub leading-relaxed">Paste the song’s link from YouTube, Spotify, JioSaavn or anywhere else.</p>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
              <span className="flex-1 min-w-0 flex items-center gap-2 rounded-xl surface px-3">
                <Link2 size={15} className="text-sub shrink-0" />
                <input ref={input} value={url} onChange={(e) => { setUrl(e.target.value); if (state.kind === 'error') setState({ kind: 'idle' }) }}
                  inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://…"
                  className="flex-1 min-w-0 h-11 bg-transparent text-[14px] text-text outline-none placeholder:text-sub/70" />
              </span>
              <button type="submit" disabled={!url.trim() || state.kind === 'sending'}
                className="shrink-0 h-11 px-4 rounded-xl bg-main text-bg text-[13px] font-medium disabled:opacity-40">
                {state.kind === 'sending' ? 'sending…' : 'send'}
              </button>
            </form>
            {link?.kind === 'file' && (
              <p className="mt-2 text-[11.5px] text-sub">That’s a song file ({link.from}): you can also add it yourself right away from the home page.</p>
            )}
            {state.kind === 'error' && <p className="mt-2 text-[12px] text-error">{state.message}</p>}
          </>
        )}
      </div>
    </div>
  )
}
