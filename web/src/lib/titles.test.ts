import { describe, expect, it } from 'vitest'
import { tidyTitle } from './titles'

describe('tidyTitle', () => {
  it('drops video noise, the film prefix and the cast list', () => {
    expect(tidyTitle('ROCKSTAR: Jo Bhi Main 8K Video Song | Ranbir Kapoor | A. R. Rahman | Mohit Chauhan', 'T-Series')).toEqual({
      title: 'Jo Bhi Main',
      artist: 'Mohit Chauhan',
    })
  })
  it('prefers the romanised name next to a Devanagari one', () => {
    expect(tidyTitle('क्या जि बोलूं। Kya Ji Bolu | Narendra Singh Negi | Sanju Silodi | Divya Negi', 'NARENDRA SINGH NEGI')).toEqual({
      title: 'Kya Ji Bolu',
      artist: 'Narendra Singh Negi',
    })
  })
  it('skips the show name and takes the singers from the credits', () => {
    expect(tidyTitle('Coke Studio Season 9| Afreen Afreen| Rahat Fateh Ali Khan & Momina Mustehsan', 'Coke Studio Pakistan')).toEqual({
      title: 'Afreen Afreen',
      artist: 'Rahat Fateh Ali Khan & Momina Mustehsan',
    })
  })
  it('strips quotes and "(Vocals Only) no music"', () => {
    expect(tidyTitle("'Labon Ko' ( Vocals Only) no music.", 'Azmain Rana').title).toBe('Labon Ko')
  })
  it('leaves clean titles alone', () => {
    expect(tidyTitle('Thinking Out Loud', 'Ed Sheeran')).toEqual({ title: 'Thinking Out Loud', artist: 'Ed Sheeran' })
    expect(tidyTitle('Raataan Lambiyan (From "Shershaah")', 'Jubin Nautiyal').title).toBe('Raataan Lambiyan (From "Shershaah")')
  })
})
