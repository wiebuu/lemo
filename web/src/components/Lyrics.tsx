import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { studio } from '../state/studio'
import { Eq, useStudio, usePhone, cx } from './ui'
import { FixLink, LyricTicker } from './LyricTicker'
import type { LyricLine } from '../lib/types'

/** Monkeytype-style words: sung = text colour, current = main with caret, upcoming = sub. */
export function Lyrics({ onEdit, onFix, big }: { onEdit: () => void; onFix: () => void; big?: boolean }) {
  const s = useStudio()
  const phone = usePhone()
  const lines = s.lyricsShown
  if (!s.track) return null
  // Timed words → the one-line moving ticker.
  if (lines.some((l) => l.words?.length)) {
    return (
      <div className="flex flex-col justify-center">
        <LyricTicker big={big} onFix={s.session ? undefined : onFix} />
      </div>
    )
  }
  if (!lines.length && s.lyricsStatus) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-sub text-sm">
        <span className="flex items-center gap-3"><Eq /> {s.lyricsStatus}</span>
        {!s.session && <FixLink onFix={onFix} label="add your own lyrics" />}
      </div>
    )
  }

  if (!lines.length) {
    return (
      <div className="h-full flex items-center justify-center text-sub text-sm">
        <button type="button" onClick={s.session ? onEdit : onFix} className="hover:text-text">
          ♪ add lyrics
        </button>
      </div>
    )
  }

  const timed = lines.some((l) => l.start !== null)
  if (!timed) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
        <div className="text-sub text-xl truncate max-w-full">{lines[0].text}</div>
        {s.lyricsStatus ? (
          <span className="flex items-center gap-2 text-xs text-sub"><Eq /> {s.lyricsStatus}</span>
        ) : (
          <button type="button" onClick={onFix} className="text-xs text-sub hover:text-text">lyrics aren't timed — fix them →</button>
        )}
        {s.lyricsStatus && !s.session && <FixLink onFix={onFix} />}
      </div>
    )
  }

  const cur = s.lyricPos.line
  const idx = cur < 0 ? 0 : cur
  const prev = cur > 0 ? lines[cur - 1] : null
  const next = lines[idx + (cur < 0 ? 0 : 1)] ?? null

  return (
    <div className="relative h-full flex flex-col items-center justify-center gap-1.5 text-center overflow-hidden px-2">
      {!s.session && !phone && (
        <span className="absolute right-0 bottom-0 flex items-center gap-2 text-[11px] text-sub">
          {s.lyricsStatus && <span className="flex items-center gap-2"><Eq />{s.lyricsStatus}</span>}
          <FixLink onFix={onFix} />
        </span>
      )}
      {/* phones: the line being sung and the next one */}
      {!phone && <div className="text-sub/60 text-base truncate max-w-full h-6">{prev?.text ?? ''}</div>}
      {cur >= 0 ? <CurrentLine line={lines[cur]} word={s.lyricPos.word} big={big} /> : <div className="text-2xl text-sub h-9">{''}</div>}
      <div className="text-sub text-lg truncate max-w-full h-7">{next?.text ?? ''}</div>
      {!s.session && phone && (
        <span className="self-end flex items-center gap-2 text-[11px] text-sub h-5">
          {s.lyricsStatus && <span className="flex items-center gap-2"><Eq />{s.lyricsStatus}</span>}
          <FixLink onFix={onFix} />
        </span>
      )}
    </div>
  )
}

function CurrentLine({ line, word, big, focus }: { line: LyricLine; word: number; big?: boolean; focus?: boolean }) {
  const size = focus ? 'text-[2.6rem] sm:text-6xl font-medium tracking-tight leading-[4rem] sm:leading-[6rem]' : big ? 'text-3xl sm:text-4xl leading-[3rem]' : 'text-2xl sm:text-[1.7rem] leading-9'
  if (!line.words?.length) {
    return <div dir="auto" className={cx('text-text truncate max-w-full transition-all duration-500', size)}>{line.text}</div>
  }
  return (
    <div dir="auto" className={cx('max-w-full truncate transition-all duration-500', size)}>
      {line.words.map((w, i) => (
        <span
          key={i}
          className={cx(
            'transition-colors duration-100',
            i < word ? 'text-text' : i === word ? 'text-main' : 'text-sub',
            i === word && 'underline decoration-2 underline-offset-8 decoration-main',
          )}
        >
          {w.text}
        </span>
      ))}
    </div>
  )
}

/**
 * Lyrics only: the graph steps aside and the lyrics sit large in the middle of the
 * screen. With no lyrics to follow (none, still loading, or not timed) the song's
 * name and singer stand there instead, so the middle is never empty.
 */
export function FocusLyrics({ onFix }: { onFix: () => void }) {
  const s = useStudio()
  const lines = s.lyricsShown
  const intro = useBeforeFirstLine(lines)
  if (!s.track) return null
  // The intro: the name and singer fade away a few seconds before the first line,
  // then the lines fade in, so there's time to get ready before singing.
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <div aria-hidden={!intro} className={cx('absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-1000 ease-out',
        intro ? 'opacity-100' : 'opacity-0 -translate-y-2 pointer-events-none')}>
        <SongTitle title={s.track.title} artist={s.track.artist} />
      </div>
      <div className={cx('w-full flex justify-center transition-opacity duration-700 ease-out', intro ? 'opacity-0' : 'opacity-100 delay-500')}>
        <FocusBody onFix={onFix} />
      </div>
    </div>
  )
}

function FocusBody({ onFix }: { onFix: () => void }) {
  const s = useStudio()
  const lines = s.lyricsShown
  if (!s.track) return null
  if (lines.some((l) => l.words?.length)) {
    return <div className="w-full"><LyricTicker focus onFix={s.session ? undefined : onFix} /></div>
  }
  if (lines.length && lines.some((l) => l.start !== null)) {
    const cur = s.lyricPos.line
    const idx = cur < 0 ? 0 : cur
    const prev = cur > 0 ? lines[cur - 1] : null
    const next = lines[idx + (cur < 0 ? 0 : 1)] ?? null
    const side = 'text-sub/70 text-lg sm:text-2xl truncate max-w-full h-8 sm:h-10 leading-8 sm:leading-10'
    return (
      <div className="w-full flex flex-col items-center gap-3 sm:gap-4 text-center px-4">
        <div dir="auto" className={side}>{prev?.text ?? ''}</div>
        {cur >= 0 ? <CurrentLine line={lines[cur]} word={s.lyricPos.word} focus /> : <div className="h-16 sm:h-24" />}
        <div dir="auto" className={cx(side, 'text-sub')}>{next?.text ?? ''}</div>
      </div>
    )
  }
  return (
    <SongTitle title={s.track.title} artist={s.track.artist}>
      {s.lyricsStatus ? <><Eq />{s.lyricsStatus}</> : !s.session && <FixLink onFix={onFix} label={lines.length ? "lyrics aren't timed — fix them" : 'add lyrics'} />}
    </SongTitle>
  )
}

function SongTitle({ title, artist, children }: { title: string; artist?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center px-6 max-w-full">
      <div className="text-[2.2rem] sm:text-6xl font-medium tracking-tight text-text leading-tight line-clamp-2 break-words">{title}</div>
      {artist && <div className="text-lg sm:text-2xl text-sub truncate max-w-full">{artist}</div>}
      <div className="mt-4 h-5 flex items-center gap-2 text-[11px] text-sub">{children}</div>
    </div>
  )
}

/** The intro: more than a few seconds before the first line is sung (the name gives way early). */
const INTRO_LEAD = 4

function useBeforeFirstLine(lines: LyricLine[]) {
  const first = lines.find((l) => l.start !== null)?.start ?? null
  const check = useCallback(() => first !== null && studio.heardTime() < first - INTRO_LEAD, [first])
  const [before, setBefore] = useState(check)
  useEffect(() => {
    setBefore(check())
    const id = setInterval(() => setBefore(check()), 250)
    return () => clearInterval(id)
  }, [check])
  return before
}
