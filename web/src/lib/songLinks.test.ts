import { describe, expect, it } from 'vitest'
import { songLink } from './songLinks'

describe('pasted links', () => {
  it('song files this device can analyse', () => {
    expect(songLink('https://drive.google.com/file/d/1AbCdEf/view?usp=sharing')).toMatchObject({ kind: 'file', from: 'Google Drive' })
    expect(songLink('https://www.dropbox.com/scl/fi/x/song.mp3?dl=0')).toMatchObject({ kind: 'file', from: 'Dropbox' })
    expect(songLink('https://1drv.ms/u/s!abc')).toMatchObject({ kind: 'file', from: 'OneDrive' })
    expect(songLink('example.com/music/my%20song.m4a')).toMatchObject({ kind: 'file', from: 'a link' })
  })
  it('YouTube: a video (maybe already in Lemody)', () => {
    expect(songLink('https://youtu.be/0hS7ti5PS5A')).toMatchObject({ kind: 'youtube', videoId: '0hS7ti5PS5A' })
    expect(songLink('https://www.youtube.com/@channel')).toMatchObject({ kind: 'locked', site: 'YouTube' })
  })
  it('sites that don’t let anyone use their songs', () => {
    expect(songLink('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x')).toMatchObject({ kind: 'locked', site: 'Spotify' })
    expect(songLink('https://www.jiosaavn.com/song/kesariya/abc')).toMatchObject({ kind: 'locked', site: 'JioSaavn' })
    expect(songLink('https://somesite.in/songs/123')).toMatchObject({ kind: 'locked', site: 'somesite.in' })
  })
  it('words are a search, not a link', () => {
    expect(songLink('tum hi ho')).toBeNull()
    expect(songLink('arijit singh')).toBeNull()
  })
})
