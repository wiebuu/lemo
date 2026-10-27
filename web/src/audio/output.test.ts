import { describe, expect, it } from 'vitest'
import { kindOf } from './output'

describe('kindOf (output device names)', () => {
  it.each([
    'Default - AirPods Pro (Bluetooth)',
    'External Headphones',
    'WH-1000XM5',
    'Galaxy Buds2',
    'USB Audio Device',
    'Headset Earpiece',
    'boAt Rockerz 450',
  ])('%s → headphones', (label) => expect(kindOf(label)).toBe('headphones'))

  it.each(['Default - MacBook Air Speakers (Built-in)', 'Speaker', 'Built-in Output', 'LG HDR 4K (Display Audio)'])(
    '%s → speaker',
    (label) => expect(kindOf(label)).toBe('speaker'),
  )

  it('unknown names stay unknown', () => {
    expect(kindOf('Default')).toBe('unknown')
    expect(kindOf('')).toBe('unknown')
  })
})
