// Turns what happens in Lemody into sound effects and notifications:
// - the studio's state changes (play, pause, mic, loop, a finished test …) → a matching cue
// - taps, typing, sliders, copy / paste anywhere on the page → small tactile cues
// - your account: welcome, songs you asked for arriving, sync trouble → notifications
// Installed once, from main.tsx.

import { analyzer } from '../api/analyzer'
import { authState, subscribeAuth } from '../auth/firebase'
import { sfx, type CueName } from '../lib/sfx'
import { setKeepPage } from '../lib/staleBuild'
import { cloudSongs, cloudStatus, refreshCloudSongs, subscribeCloud } from './cloud'
import { notifications, recordScore, settleRequests } from './notifications'
import { studio, type Snapshot } from './studio'

// ---- sounds from the studio's state --------------------------------------------------------

let loadingLoop: { stop: () => void } | null = null
let loadingCap: ReturnType<typeof setTimeout> | undefined
function stopLoading() {
  clearTimeout(loadingCap)
  loadingLoop?.stop()
  loadingLoop = null
}

function toastCue(text: string): CueName {
  if (/breath mark added/.test(text)) return 'drop'
  if (/removed|cleared/.test(text)) return 'delete'
  if (/couldn|could not|too short|no sound/.test(text)) return 'warning'
  if (/kept private/.test(text)) return 'lock'
  return 'info'
}

function onStudio(p: Snapshot, s: Snapshot) {
  // the sound settings themselves
  const st = s.settings
  if (st.sfx !== p.settings.sfx || st.sfxPack !== p.settings.sfxPack || st.sfxVolume !== p.settings.sfxVolume) {
    sfx.configure({ enabled: st.sfx, pack: st.sfxPack, volume: st.sfxVolume })
    if (st.sfx && !p.settings.sfx) sfx.play('toggle-on')
    return
  }

  // a song opened / closed
  if (s.track?.id !== p.track?.id) {
    stopLoading()
    if (s.track) sfx.play('open', { volume: 0.8 })
    else sfx.play('back', { volume: 0.7 })
  }

  // working (loading a song, preparing its audio): a quiet pulse, never for long
  if (!!s.busy !== !!p.busy) {
    if (s.busy && !loadingLoop) {
      loadingLoop = sfx.play('loading', { volume: 0.6, loop: true })
      loadingCap = setTimeout(stopLoading, 12_000)
    } else if (!s.busy) stopLoading()
  }

  // a test ended: scored, or too short
  if (p.session && !s.session) {
    const score = s.lastResult?.overall.score ?? null
    sfx.play(score === null ? 'stop' : score >= 0.85 ? 'streak' : 'complete')
    if (score !== null && s.track && !s.viewing) {
      const before = recordScore(s.track.id, score)
      if (before !== null)
        notifications.notify({
          kind: 'best',
          title: `New personal best: ${Math.round(score * 100)}%`,
          body: `on “${s.track.title}” — up from ${Math.round(before * 100)}%.`,
        })
    }
  } else if (s.playing !== p.playing && !s.session) {
    sfx.play(s.playing ? 'play' : 'pause', { volume: 0.8 })
  }

  if (s.mic !== p.mic && (s.mic === 'on' || p.mic === 'on')) sfx.play(s.mic === 'on' ? 'connect' : 'disconnect', { volume: 0.8 })
  if (s.muted !== p.muted) sfx.play(s.muted ? 'toggle-off' : 'toggle-on')
  if (!!s.loop !== !!p.loop) sfx.play(s.loop ? 'snap' : 'release')
  if (s.metronome !== p.metronome) sfx.play(s.metronome ? 'toggle-on' : 'toggle-off')
  if (s.speed !== p.speed || s.transpose !== p.transpose) sfx.play('select', { cooldownMs: 90 })
  if (s.phrase !== p.phrase && !s.playing && s.track) sfx.play('seek', { volume: 0.6, cooldownMs: 60 })
  if (s.listenSource !== p.listenSource || s.resultsView !== p.resultsView || s.reviewAspect !== p.reviewAspect) sfx.play('select')
  if (s.voiceFx !== p.voiceFx) sfx.play('select', { cooldownMs: 120 })
  if (p.coverMaking && !s.coverMaking && !s.error) sfx.play('success')
  if (s.replay && !p.replay && !p.session) sfx.play('open', { volume: 0.6 })

  // look & settings
  if (st.theme !== p.settings.theme) sfx.play('select')
  else if (st.lyricsOnly !== p.settings.lyricsOnly) sfx.play(st.lyricsOnly ? 'expand' : 'collapse')
  else if (st.disco !== p.settings.disco) sfx.play(st.disco ? 'toggle-on' : 'toggle-off')
  else if (st !== p.settings && s.track?.id === p.track?.id) sfx.play('select', { volume: 0.6, cooldownMs: 120 })

  // messages
  if (s.toast && s.toast.id !== p.toast?.id) sfx.play(toastCue(s.toast.text), { volume: 0.7 })
  if (s.error && s.error !== p.error) sfx.play('error')
  if (s.micError && s.micError !== p.micError) sfx.play('blocked')

  // your take made today's top
  const top = s.topRank
  if (top?.id && top.id !== p.topRank?.id && !s.viewing) {
    notifications.notify({
      key: `top:${top.id}`,
      kind: 'top',
      title: `#${top.rank} in today’s top!`,
      body: s.track ? `Your take of “${s.track.title}” made today’s best 100.` : 'Your take made today’s best 100.',
      href: '/top',
    })
  }

  // a friend's link: a score to beat
  if (s.challenge !== null && s.challenge !== p.challenge && s.track) {
    notifications.notify({
      key: `challenge:${s.track.id}:${s.challenge}`,
      kind: 'challenge',
      title: `Beat ${Math.round(s.challenge)}% on “${s.track.title}”`,
      body: 'A friend sent you this song with their score. Start a test to take them on.',
      songId: s.track.id,
    })
  }
}

// ---- small tactile cues anywhere on the page ------------------------------------------------

const PRESSABLE = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], summary, label, select, input[type="checkbox"], input[type="radio"]'
const TEXT = 'input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], textarea, [contenteditable="true"]'

function installDom() {
  const unlock = () => sfx.unlock()

  // a tap on anything pressable: one soft tick (no sound on hover)
  window.addEventListener('pointerdown', (e) => {
    unlock()
    const el = (e.target as Element | null)?.closest?.(PRESSABLE) as HTMLButtonElement | null
    if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true') sfx.tick()
  }, true)

  window.addEventListener('keydown', (e) => {
    unlock()
    const el = e.target as Element | null
    if (!el?.closest?.(TEXT) || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Backspace' || e.key === 'Delete') sfx.play('typing', { volume: 0.6, cooldownMs: 25 })
    else if (e.key.length === 1) sfx.play('typing', { volume: 0.8, cooldownMs: 25 })
  }, true)

  // sliders: volume, speed, latency …
  window.addEventListener('input', (e) => {
    if ((e.target as HTMLInputElement | null)?.type === 'range') sfx.play('volume-change', { volume: 0.8, cooldownMs: 90 })
  }, true)
  window.addEventListener('focusin', (e) => {
    if ((e.target as Element | null)?.closest?.(TEXT)) sfx.play('focus', { volume: 0.7, cooldownMs: 150 })
  })
  window.addEventListener('copy', () => sfx.play('copy'))
  window.addEventListener('paste', () => sfx.play('paste'))
  // a file dropped onto the page (a song)
  window.addEventListener('drop', () => sfx.play('drop'), true)
}

// ---- your account ---------------------------------------------------------------------------

let pollTimer: ReturnType<typeof setInterval> | undefined
let polling = false

/** Songs you asked for that are now in your songs → a notification (also on your next visit). */
async function checkRequests() {
  if (polling || document.hidden) return
  polling = true
  try {
    const pending = await analyzer.requests().catch(() => null)
    if (!pending) return
    await refreshCloudSongs() // a song that's ready is on your list by now
    settleRequests(pending, new Set(cloudSongs().map((s) => s.id)))
  } finally {
    polling = false
  }
}

function installAccount() {
  let last: ReturnType<typeof authState>['status'] | null = null
  let syncWarned = false

  {
    const apply = () => {
      const a = authState()
      if (a.status === last) return
      const was = last
      last = a.status
      clearInterval(pollTimer)
      if (a.status === 'signed-in') {
        notifications.setOwner(a.user.uid)
        if (was === 'signed-out') sfx.play('unlock')
        const first = (a.user.displayName ?? '').trim().split(/\s+/)[0]
        notifications.notify({
          key: 'welcome',
          kind: 'welcome',
          title: first ? `Welcome to Lemody, ${first}` : 'Welcome to Lemody',
          body: 'Your scores, songs and settings now follow you to any device. News shows up here — like when a song you asked for is ready.',
        })
        setTimeout(() => void checkRequests(), 4000) // after your song list has loaded
        pollTimer = setInterval(() => void checkRequests(), 120_000)
      } else if (a.status === 'signed-out' || a.status === 'unconfigured') {
        if (was === 'signed-in') sfx.play('lock')
        notifications.setOwner(null)
        notifications.notify({
          key: 'welcome',
          kind: 'welcome',
          title: 'Welcome to Lemody',
          body: 'Pick a song, sing along and see your voice next to the singer’s. Sign in to get news here when a song you asked for is added.',
        })
      }
    }
    subscribeAuth(apply)
    apply()
    subscribeCloud(() => {
      if (cloudStatus().state !== 'unavailable' || syncWarned) return
      syncWarned = true
      notifications.notify({
        kind: 'sync',
        title: 'Can’t reach your account right now',
        body: 'Your scores and songs are kept in this browser and upload as soon as it’s back.',
      })
    })
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && last === 'signed-in') void checkRequests()
  })
}

// ---- install -------------------------------------------------------------------------------

let installed = false
export function installFeedback() {
  if (installed) return
  installed = true
  const st = studio.snap.settings
  sfx.configure({ enabled: st.sfx, pack: st.sfxPack, volume: st.sfxVolume })
  // never into your take: quiet while a test records, or while the song plays with the mic open
  sfx.setBlocked(() => {
    const s = studio.snap
    return s.session || (s.mic === 'on' && s.playing && !s.muted)
  })
  let prev = studio.snap
  studio.subscribe(() => {
    const s = studio.snap
    if (s === prev) return
    const p = prev
    prev = s
    onStudio(p, s)
  })
  // a new version deployed while a song is open: never reload it away (results, a take, edits)
  setKeepPage(
    () => !!studio.snap.track,
    () => studio.toast('Lemody was just updated. Reload the page to use this.', 5000),
  )
  installDom()
  installAccount()
}
