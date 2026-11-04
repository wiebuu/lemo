import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/firebase'
import { startCloud, stopCloud } from '../state/cloud'
import { SiteFooter } from '../pages/Footer'
import { Splash, Wordmark } from './Brand'

const SPLASH_MS = 1800

/** Lemody opens for everyone: a guest can find, open and sing any song. Signing in with
 * Google (the header's button) keeps your settings, songs and scores in your account. */
export function AuthGate({ children }: { children: ReactNode }) {
  const a = useAuth()
  const uid = a.status === 'signed-in' ? a.user.uid : null
  // the loading screen always plays through once (the wave draws in ~1.1 s), even when sign-in is instant
  const [shown, setShown] = useState(() => performance.now() >= SPLASH_MS)
  useEffect(() => {
    if (shown) return
    const t = setTimeout(() => setShown(true), SPLASH_MS - performance.now())
    return () => clearTimeout(t)
  }, [shown])
  // your settings, song list and scores sync with your account while you're signed in
  useEffect(() => {
    if (!uid) return
    void startCloud(uid)
    return () => stopCloud()
  }, [uid])
  if (a.status === 'loading' || !shown) return <Splash />
  if (a.status === 'signed-in' || a.status === 'signed-out') return <>{children}</>
  // unconfigured: Firebase isn't set up (a developer's copy)
  return (
    <div className="h-dvh flex flex-col items-center justify-center px-6">
      <div className="fade-in w-full max-w-sm flex flex-col items-center text-center">
        <Wordmark size="lg" />
        <div className="mt-10 text-left text-sm text-sub leading-relaxed surface rounded-xl p-5">
          <div className="text-text font-medium mb-2">Firebase isn't set up yet</div>
          Sign-in needs a Firebase project with Google sign-in turned on. Copy <code className="text-text">web/.env.example</code> to{' '}
          <code className="text-text">web/.env.local</code>, fill in your project's web app settings, and restart{' '}
          <code className="text-text">npm run dev</code>. The README has the steps.
        </div>
      </div>
      <SiteFooter className="fixed bottom-0 inset-x-0 pb-[max(1.25rem,env(safe-area-inset-bottom))]" />
    </div>
  )
}
