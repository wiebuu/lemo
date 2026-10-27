import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { signInWithGoogle, useAuth } from '../auth/firebase'
import { startCloud, stopCloud } from '../state/cloud'
import { SiteFooter } from '../pages/Footer'
import { go } from '../pages/router'
import { Splash, Wordmark } from './Brand'

const SPLASH_MS = 1800

/** Nothing of lemo is shown — and no analyzer request is made — until you've signed in with Google. */
export function AuthGate({ children }: { children: ReactNode }) {
  const a = useAuth()
  const uid = a.status === 'signed-in' ? a.user.uid : null
  const [signing, setSigning] = useState(false)
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
  if (a.status === 'signed-in') return <>{children}</>
  if (a.status === 'loading' || !shown) return <Splash />
  return (
    <div className="h-dvh flex flex-col items-center justify-center px-6">
      <div className="fade-in w-full max-w-sm flex flex-col items-center text-center">
        <Wordmark size="lg" />
        {a.status === 'signed-out' && (
          <>
            <h1 className="mt-10 text-2xl font-semibold tracking-tight text-text">Sign in to start singing</h1>
            <button
              type="button"
              disabled={signing}
              onClick={async () => {
                setSigning(true)
                try {
                  await signInWithGoogle()
                } finally {
                  setSigning(false)
                }
              }}
              className="mt-8 w-full flex items-center justify-center gap-3 rounded-full bg-white text-[#1f1f1f] text-sm font-medium h-11 border border-[#747775] hover:bg-[#f2f2f2] active:scale-[.99]"
            >
              {signing ? <Loader2 size={18} className="animate-spin text-[#5f6368]" /> : <GoogleG />}
              {signing ? 'Waiting for Google…' : 'Continue with Google'}
            </button>
            {a.error && <p className="mt-4 text-xs text-error leading-relaxed">{a.error}</p>}
            <p className="mt-6 text-[11px] text-sub leading-relaxed">
              By continuing you agree to the <a href="/terms" onClick={go} className="text-text/80 hover:text-main underline underline-offset-2">terms</a> and{' '}
              <a href="/privacy" onClick={go} className="text-text/80 hover:text-main underline underline-offset-2">privacy policy</a>.
            </p>
          </>
        )}
        {a.status === 'unconfigured' && (
          <div className="mt-10 text-left text-sm text-sub leading-relaxed surface rounded-xl p-5">
            <div className="text-text font-medium mb-2">Firebase isn't set up yet</div>
            Sign-in needs a Firebase project with Google sign-in turned on. Copy <code className="text-text">web/.env.example</code> to{' '}
            <code className="text-text">web/.env.local</code>, fill in your project's web app settings, and restart{' '}
            <code className="text-text">npm run dev</code>. The README has the steps.
          </div>
        )}
      </div>
      <SiteFooter className="fixed bottom-0 inset-x-0 pb-[max(1.25rem,env(safe-area-inset-bottom))]" />
    </div>
  )
}

/** Google's "G" mark, as their sign-in button guidelines ask. */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
