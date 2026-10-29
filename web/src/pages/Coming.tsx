import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Laptop, Play, Upload } from 'lucide-react'
import { analyzer, type RequestBoard } from '../api/analyzer'
import { useAuth } from '../auth/firebase'
import { songLink } from '../lib/songLinks'
import { tidyTitle } from '../lib/titles'
import { studio } from '../state/studio'
import { cx } from '../components/ui'
import { go, navigate } from './router'

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
          {board.pending.length === 0 && <p>Nothing waiting — every song asked for is in. Paste a link on the home page to ask for one.</p>}
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
          <p className="mt-6">Want a song that isn’t here? <a href="/" onClick={go}>Paste its link on the home page</a>.</p>
        </>
      )}
    </>
  )
}
