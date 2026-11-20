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
  },

  /** Play a cue. Returns a handle (loops: stop it), or null when nothing played. */
  play(cue: CueName, o: PlayOpts = {}): PlayingSFX | null {
    if (!enabled || !unlocked || blocked() || document.hidden) return null
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
