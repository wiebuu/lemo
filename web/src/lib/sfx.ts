// Sound effects for the interface (uisfx: semantic UI cues, CC0, synthesized in the
// browser — no audio files are fetched). One player for the whole site.
//
// Lemody listens to your voice, so the rule that matters most: no effect ever plays
// while a test is recording, or while the song plays with the mic open (it would end
// up in your take and in the pitch line). See `setBlocked` in state/feedback.ts.

import { createUISFX, getCue, type CueName, type PlayingSFX, type UISFXPlayer } from 'uisfx'
import type { SfxPack } from '../state/persist'

export type { CueName }

let player: UISFXPlayer | null = null
let enabled = true
let pack: SfxPack = 'studio'
let volume = 0.6
let unlocked = false
let blocked: () => boolean = () => false
let tickCtx: AudioContext | null = null
let lastInput = -Infinity
let lastCue = -Infinity

/** Sounds that answer something you did; news (a notification, a result, an error) plays anyway. */
const REACTIONS = new Set<CueName>([
  'press', 'release', 'select', 'deselect', 'toggle-on', 'toggle-off', 'check', 'uncheck', 'delete', 'cancel',
  'open', 'close', 'back', 'forward', 'expand', 'collapse', 'snap', 'play', 'pause', 'seek', 'connect', 'disconnect',
  'reaction', 'volume-change', 'typing', 'copy', 'paste', 'drop',
])

function get(): UISFXPlayer {
  if (!player) player = createUISFX({ pack, volume, enabled, maxVoices: 6, cooldownMs: 35 })
  return player
}

export interface PlayOpts {
  /** 0–1: a share of the cue's own designed level (uisfx's volume option replaces that level) */
  volume?: number
  /** ignore repeats closer than this (ms) */
  cooldownMs?: number
  /** keep repeating until stopped (loop cues such as `loading`) */
  loop?: boolean
}

export const sfx = {
  configure(o: { enabled: boolean; pack: SfxPack; volume: number }) {
    enabled = o.enabled
    pack = o.pack
    volume = o.volume
    if (!player) return
    player.setEnabled(enabled)
    player.setPack(pack)
    player.setVolume(volume)
  },

  /** What keeps the effects quiet right now (a test recording, the mic open while singing). */
  setBlocked(fn: () => boolean) {
    blocked = fn
  },

  /** Web Audio may only start from a tap or a key: called on the first one. */
  unlock() {
    if (unlocked) return
    unlocked = true
    void get().unlock()
    try {
      tickCtx = new AudioContext()
    } catch {
      /* no Web Audio: no ticks */
    }
  },

  /** The plain tap sound for buttons and links: one soft, low "tok" (not a uisfx cue). */
  tick(level = 1) {
    if (!enabled || !unlocked || !tickCtx || blocked() || document.hidden) return
    try {
      const c = tickCtx
      if (c.state === 'suspended') void c.resume()
      const t = c.currentTime
      const o = c.createOscillator()
      const lp = c.createBiquadFilter()
      const g = c.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(520, t)
      o.frequency.exponentialRampToValueAtTime(330, t + 0.05)
      lp.type = 'lowpass'
      lp.frequency.value = 1200
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.06 * volume * level, t + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
      o.connect(lp).connect(g).connect(c.destination)
      o.start(t)
      o.stop(t + 0.08)
    } catch {
      /* a nicety */
    }
  },

  /** A real tap or key press just happened (reaction sounds only follow one of these). */
  noteInput() {
    lastInput = performance.now()
  },

  /** When the last cue (not a tick) started, to give each action just one sound. */
  lastCueAt() {
    return lastCue
  },

  /** Play a cue. Returns a handle (loops: stop it), or null when nothing played. */
  play(cue: CueName, o: PlayOpts = {}): PlayingSFX | null {
    if (!enabled || !unlocked || blocked() || document.hidden) return null
    // a control's reaction (a toggle, a menu opening …) only right after you did something:
    // never for changes that happen by themselves (settings syncing, a song ending …)
    if (REACTIONS.has(cue) && performance.now() - lastInput > 1500) return null
    lastCue = performance.now()
    try {
      return get().play(cue, { volume: getCue(cue).defaultVolume * (o.volume ?? 1), cooldownMs: o.cooldownMs, loop: o.loop, retrigger: o.loop ? 'ignore' : 'restart' })
    } catch {
      return null // sound is a nicety: never let it break a tap
    }
  },

  /** Hear one sound in a given pack (the settings' preview), whatever the current state. */
  preview(cue: CueName, previewPack: SfxPack) {
    if (!unlocked) this.unlock()
    const p = get()
    p.setEnabled(true)
    p.setPack(previewPack)
    p.play(cue)
  },

  stopAll() {
    player?.stopAll()
  },
}
