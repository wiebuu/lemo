import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { navigate } from '../pages/router'
import { cx } from './ui'

/**
 * A singer's name or picture, wherever it's shown, which opens their public profile.
 * It can sit inside a row that does something else on a click (opening a take), so it
 * keeps its own click to itself. A guest (no username) is plain.
 */
function ProfileLink({ username, label, className, children }: { username: string; label: string; className?: string; children: ReactNode }) {
  const open = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation()
    e.preventDefault()
    navigate(`/u/${username}`)
    window.scrollTo(0, 0)
  }
  return (
    <span role="link" tabIndex={0} title={label} aria-label={label} onClick={open} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(e)}
      className={cx('cursor-pointer', className)}>
      {children}
    </span>
  )
}

/** Their real name (not their username): a faint underline just under it, so it reads as a link on phones too. */
export function SingerName({ name, username, className }: { name: string; username?: string | null; className?: string }) {
  if (!username) return <span className={className}>{name}</span>
  return (
    <ProfileLink username={username} label={`${name}'s profile`}
      className={cx(className, 'underline decoration-1 decoration-sub/40 underline-offset-[1.5px] transition-colors hover:decoration-current focus-visible:decoration-current')}>
      {name}
    </ProfileLink>
  )
}

/** Their picture (or whatever stands in for it), opening their profile too. */
export function SingerPhoto({ name, username, className, children }: { name: string; username?: string | null; className?: string; children: ReactNode }) {
  if (!username) return <>{children}</>
  return (
    <ProfileLink username={username} label={`${name}'s profile`} className={cx('shrink-0 inline-flex rounded-full transition-opacity hover:opacity-80', className)}>
      {children}
    </ProfileLink>
  )
}
