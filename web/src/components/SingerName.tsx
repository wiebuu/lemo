import type { KeyboardEvent, MouseEvent } from 'react'
import { navigate } from '../pages/router'
import { cx } from './ui'

/**
 * A singer's name, wherever it's shown: their real name (not their username), which opens
 * their public profile.
 * It can sit inside a row that does something else on a click (opening a take), so it
 * keeps its own click to itself. A guest (no username) is plain text.
 */
export function SingerName({ name, username, className }: { name: string; username?: string | null; className?: string }) {
  if (!username) return <span className={className}>{name}</span>
  const open = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation()
    e.preventDefault()
    navigate(`/u/${username}`)
    window.scrollTo(0, 0)
  }
  return (
    <span role="link" tabIndex={0} title={`${name}'s profile`} onClick={open} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(e)}
      className={cx(className, 'cursor-pointer hover:underline underline-offset-2 decoration-from-font')}>
      {name}
    </span>
  )
}
