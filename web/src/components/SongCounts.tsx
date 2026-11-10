import { ChallengeBadge } from './Challenge'
import type { CatalogItem } from '../api/analyzer'
import { useSong } from '../state/library'
import type { ReferenceTrack } from '../lib/types'
import { LikeButton } from './Like'

/** A song's plays, for its info: YouTube views (counted once a week) and tests on Lemody. */
export function SongCounts({ song }: { song: CatalogItem | undefined }) {
  if (!song) return null
  return (
    <span className="block mb-1">
      {song.views != null && <span className="block">{song.views.toLocaleString()} plays on YouTube</span>}
      <span className="block">sung {(song.sung ?? 0).toLocaleString()} time{song.sung === 1 ? '' : 's'} on Lemody</span>
    </span>
  )
}

/** Phones: the open song's name above the graph, with ♥ (the header has no room). */
export function PhoneSongName({ track }: { track: ReferenceTrack }) {
  const song = useSong(track.id)
  // a friend's score to beat goes on its own line: the name keeps its room
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-0">
      <div className="flex items-center justify-center gap-2 min-w-0 max-w-full">
        <div className="truncate leading-tight text-[12px]">
          <span className="text-text font-medium">{track.title}</span>
          {track.artist && <span className="text-sub"> · {track.artist}</span>}
        </div>
        {song && <LikeButton id={track.id} size={13} />}
      </div>
      <ChallengeBadge />
    </div>
  )
}
