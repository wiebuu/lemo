import { describe, expect, it } from 'vitest'
import { searchSongs, youtubeId } from './songSearch'

const songs = [
  { id: 'yt-1', title: 'Tum Hi Ho', artist: 'Arijit Singh' },
  { id: 'yt-2', title: 'Coke Studio Season 9| Afreen Afreen| Rahat Fateh Ali Khan & Momina Mustehsan', artist: 'Coke Studio' },
  { id: 'yt-3', title: 'Perfect', artist: 'Ed Sheeran' },
  { id: 'yt-4', title: 'Thinking Out Loud', artist: 'Ed Sheeran' },
  { id: 'yt-5', title: 'Channa Mereya', artist: 'Arijit Singh' },
]
const ids = (q: string) => searchSongs(songs, q).map((s) => s.id)

describe('searchSongs', () => {
  it('finds by song name, any case', () => expect(ids('tum hi')).toEqual(['yt-1']))
  it('finds by singer', () => expect(ids('arijit').sort()).toEqual(['yt-1', 'yt-5']))
  it('half-typed words and any order', () => expect(ids('sheer perf')).toEqual(['yt-3']))
  it('looks inside messy YouTube titles', () => expect(ids('rahat')).toEqual(['yt-2']))
  it('shows the tidy name', () => expect(searchSongs(songs, 'afreen')[0].shownTitle).toBe('Afreen Afreen'))
  it('title matches come before singer matches', () => {
    const list = [{ id: 'a', title: 'Ed Song', artist: 'Someone' }, { id: 'b', title: 'Other', artist: 'Ed Sheeran' }]
    expect(searchSongs(list, 'ed').map((s) => s.id)).toEqual(['a', 'b'])
  })
  it('nothing typed, nothing found', () => expect(ids('  ')).toEqual([]))
  it('no match', () => expect(ids('bohemian')).toEqual([]))
})

describe('youtubeId', () => {
  it('reads common links', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=fsiPzT50ZiM&t=3')).toBe('fsiPzT50ZiM')
    expect(youtubeId('youtu.be/fsiPzT50ZiM')).toBe('fsiPzT50ZiM')
    expect(youtubeId('https://m.youtube.com/shorts/fsiPzT50ZiM')).toBe('fsiPzT50ZiM')
  })
  it('a song name is not a link', () => expect(youtubeId('tum hi ho')).toBeNull())
})
