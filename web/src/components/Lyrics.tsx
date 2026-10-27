import { Eq, useStudio, cx } from './ui'
import { FixLink, LyricTicker } from './LyricTicker'
import type { LyricLine } from '../lib/types'

/** Monkeytype-style words: sung = text colour, current = main with caret, upcoming = sub. */
export function Lyrics({ onEdit, onFix, big }: { onEdit: () => void; onFix: () => void; big?: boolean }) {
  const s = useStudio()
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
      {!s.session && (
        <span className="absolute right-0 bottom-0 flex items-center gap-2 text-[11px] text-sub">
          {s.lyricsStatus && <span className="flex items-center gap-2"><Eq />{s.lyricsStatus}</span>}
          <FixLink onFix={onFix} />
        </span>
      )}
      <div className="text-sub/60 text-base truncate max-w-full h-6">{prev?.text ?? ''}</div>
      {cur >= 0 ? <CurrentLine line={lines[cur]} word={s.lyricPos.word} big={big} /> : <div className="text-2xl text-sub h-9">{''}</div>}
      <div className="text-sub text-lg truncate max-w-full h-7">{next?.text ?? ''}</div>
    </div>
  )
}

function CurrentLine({ line, word, big }: { line: LyricLine; word: number; big?: boolean }) {
  if (!line.words?.length) {
    return <div className={cx('text-text truncate max-w-full transition-all duration-500', big ? 'text-3xl sm:text-4xl leading-[3rem]' : 'text-2xl sm:text-[1.7rem] leading-9')}>{line.text}</div>
  }
  return (
    <div className={cx('max-w-full truncate transition-all duration-500', big ? 'text-3xl sm:text-4xl leading-[3rem]' : 'text-2xl sm:text-[1.7rem] leading-9')}>
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
