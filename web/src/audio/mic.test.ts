import { describe, expect, it } from 'vitest'
import { isBluetoothMic } from './mic'

describe('isBluetoothMic', () => {
  it('knows Bluetooth earphones', () => {
    for (const l of ['AirPods Pro', 'Galaxy Buds2', 'Bluetooth headset', 'Hands-Free AG Audio', 'BT Earphones']) expect(isBluetoothMic(l)).toBe(true)
  })
  it('leaves wired earphones and the phone alone (their sound must stay in the earphones)', () => {
    for (const l of ['Headset earpiece', 'Wired headset', 'iPhone Microphone', 'Built-in Microphone', 'USB audio']) expect(isBluetoothMic(l)).toBe(false)
  })
})
