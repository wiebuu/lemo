import { ChartColumn, CircleHelp, Crown, Info, LogOut, Music2, PencilLine, Settings, Shield } from 'lucide-react'
import { signOut, useAuth } from '../auth/firebase'
import { useCloud } from '../state/cloud'
import { navigate } from '../pages/router'
import { studio } from '../state/studio'
import { Wordmark } from './Brand'
import { DjIcon } from './DjIcon'
import { WiecodesCredit } from './Credit'
import { IconToggle, Menu, MenuItem, Tip, useStudio, usePhone, cx } from './ui'

export type Panel = 'load' | 'settings' | 'lyrics' | 'fixlyrics' | 'tutorial' | 'calibrate' | null

export function Header({ open }: { open: (p: Panel) => void }) {
  const s = useStudio()
  const phone = usePhone()
  const t = s.track
  return (
    // below the notch / status bar when Lemody runs full screen (added to the home screen)
    <header className="flex items-center gap-2 sm:gap-4 pt-[max(0.75rem,calc(env(safe-area-inset-top)-0.5rem))] pb-1.5 sm:pt-[max(1.25rem,calc(env(safe-area-inset-top)-0.5rem))] sm:pb-3 shrink-0">
      <button type="button" onClick={() => { open(null); studio.goHome() }} className="shrink-0" aria-label="home">
        <Wordmark />
      </button>
      <nav className={cx('flex items-center ml-1 sm:ml-3 transition-all duration-500', s.session && 'opacity-0 pointer-events-none -translate-y-1')}>
        {t && (
          <IconToggle tip="Load a song" onClick={() => open('load')}>
            <Music2 size={17} />
          </IconToggle>
        )}
        <IconToggle tip="Lyrics & breath marks" onClick={() => open('lyrics')} disabled={!t} why="Load a song first.">
          <PencilLine size={17} />
        </IconToggle>
        <IconToggle tip="Settings" onClick={() => open('settings')}>
          <Settings size={17} />
        </IconToggle>
        <IconToggle tip="How Lemody works" onClick={() => open('tutorial')}>
          <Info size={17} />
        </IconToggle>
        {!phone && ( // phones: in the account menu
          <>
            <IconToggle tip="Today's top" onClick={() => navigate('/top')}>
              <Crown size={17} />
            </IconToggle>
            <IconToggle tip="Stats" onClick={() => navigate('/stats')}>
              <ChartColumn size={17} />
            </IconToggle>
          </>
        )}
      </nav>
      <div className="flex-1" />
      {t && (
        <Tip tip={`Melody from: ${t.melodySource}`}>
          <div className="min-w-0 text-right leading-tight hidden sm:block">
            <div className="text-sm font-medium text-text truncate">{t.title}</div>
            {t.artist && <div className="text-[11px] text-sub truncate tracking-wide">{t.artist}</div>}
          </div>
        </Tip>
      )}
      {!phone && (
        <Tip tip={s.settings.disco ? 'Disco lights · on' : 'Disco lights'}>
          <button type="button" aria-label="disco lights" aria-pressed={s.settings.disco}
            onClick={() => studio.updateSettings({ disco: !s.settings.disco })}
            className="p-0.5 shrink-0 transition-transform hover:scale-110 active:scale-95">
            <DjIcon on={s.settings.disco} beating={!s.playing} />
          </button>
        </Tip>
      )}
      <Account />
    </header>
  )
}

/** Who's signed in, and signing out. */
function Account() {
  const a = useAuth()
  const cloud = useCloud()
  if (a.status !== 'signed-in') return null
  const u = a.user
  const sync =
    cloud.state === 'synced' ? 'saved to your account'
      : cloud.state === 'syncing' ? 'saving to your account…'
        : cloud.state === 'unavailable' ? 'not syncing — saved in this browser for now'
          : ''
  const initial = (u.displayName ?? u.email ?? '?').trim().charAt(0).toUpperCase()
  return (
    <Menu
      tip={u.email ?? 'Your account'}
      buttonClassName="p-0"
      button={
        u.photoURL ? (
          <img src={u.photoURL} alt="" referrerPolicy="no-referrer" className="w-7 h-7 rounded-full" />
        ) : (
          <span className="w-7 h-7 rounded-full bg-sub-alt text-text text-xs flex items-center justify-center">{initial}</span>
        )
      }
    >
      {(close) => (
        <>
          <div className="px-2 pt-1 pb-2">
            <div className="text-sm text-text truncate">{u.displayName ?? 'Signed in'}</div>
            <div className="text-[11px] text-sub truncate">{u.email}</div>
            {sync && (
              <Tip tip={cloud.state === 'unavailable' ? `Your settings, song list and scores can't reach the database (${cloud.message ?? 'unknown error'}). They're kept in this browser and upload when it's back.` : 'Your settings, song list and scores follow you to any device you sign in on.'}>
                <div className={cx('mt-1.5 text-[11px] flex items-center gap-1.5', cloud.state === 'unavailable' ? 'text-error' : 'text-sub')}>
                  <span className={cx('w-1.5 h-1.5 rounded-full', cloud.state === 'unavailable' ? 'bg-error' : cloud.state === 'syncing' ? 'bg-sub' : 'bg-main')} />
                  {sync}
                </div>
              </Tip>
            )}
          </div>
          <MenuItem icon={<Crown size={14} />} label="today's top" tip="The best takes sung today — open one to hear it." onClick={() => { close(); navigate('/top') }} />
          <MenuItem icon={<ChartColumn size={14} />} label="stats" tip="Lemody in numbers." onClick={() => { close(); navigate('/stats') }} />
          <MenuItem icon={<CircleHelp size={14} />} label="help & questions" tip="Answers to common questions." onClick={() => { close(); navigate('/help') }} />
          <MenuItem icon={<Shield size={14} />} label="privacy" tip="What Lemody keeps, and what it never does." onClick={() => { close(); navigate('/privacy') }} />
          <MenuItem icon={<LogOut size={14} />} label="sign out" tip="Sign out of Lemody on this device." onClick={() => { close(); void signOut() }} />
          <div className="mt-1 pt-2 px-2 border-t border-line">
            <WiecodesCredit />
          </div>
        </>
      )}
    </Menu>
  )
}
