import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
})

const { persist, DEFAULT_SETTINGS } = await import('./persist')

describe('graph layers by default', () => {
  beforeEach(() => store.clear())

  it('new singers: timing off, real pitch on', () => {
    const s = persist.settings()
    expect(s.layers.timing).toBe(false)
    expect(s.layers.exact).toBe(true)
  })

  it('settings saved before the change are switched over once', () => {
    store.set('lemo.settings', JSON.stringify({ layers: { shape: true, loudness: true, exact: false, timing: true } }))
    const s = persist.settings()
    expect(s.layers).toEqual({ shape: true, loudness: true, exact: true, timing: false })
  })

  it('after that, what you pick stays', () => {
    persist.saveSettings({ ...DEFAULT_SETTINGS, layers: { ...DEFAULT_SETTINGS.layers, timing: true, exact: false } }, { fromCloud: true })
    const s = persist.settings()
    expect(s.layers.timing).toBe(true)
    expect(s.layers.exact).toBe(false)
  })
})
