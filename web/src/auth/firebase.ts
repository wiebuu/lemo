// Sign-in with Google through Firebase Auth — the only way in. Any other kind of
// account (email, phone, anonymous …) is signed straight back out, and every
// request to the analyzer carries the Google ID token, which it verifies.

import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onIdTokenChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { useSyncExternalStore } from 'react'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

/** All four values are needed; without them the app explains how to set Firebase up. */
export const firebaseConfigured = Object.values(config).every((v) => typeof v === 'string' && v.length > 0)

export type AuthState =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'signed-out'; error?: string }
  | { status: 'signed-in'; user: User }

let state: AuthState = firebaseConfigured ? { status: 'loading' } : { status: 'unconfigured' }
const listeners = new Set<() => void>()
const setState = (s: AuthState) => {
  state = s
  listeners.forEach((l) => l())
}

let auth: Auth | null = null
const isGoogle = (u: User) => u.providerData.some((p) => p.providerId === 'google.com')

export function startAuth() {
  if (!firebaseConfigured || auth) return
  auth = getAuth(initializeApp(config))
  void setPersistence(auth, browserLocalPersistence)
  onIdTokenChanged(auth, (u) => {
    if (u && !isGoogle(u)) {
      // only Google accounts may use lemo
      void fbSignOut(auth!)
      return setState({ status: 'signed-out', error: 'Only Google sign-in is allowed.' })
    }
    setState(u ? { status: 'signed-in', user: u } : { status: 'signed-out' })
  })
  installApiAuth()
}

export async function signInWithGoogle() {
  if (!auth) return
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  try {
    await signInWithPopup(auth, provider)
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    if (code === 'auth/popup-blocked') return signInWithRedirect(auth, provider)
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return
    setState({ status: 'signed-out', error: friendly(code, (e as Error).message) })
  }
}

/** The signed-in user's ID token, for requests fetch() doesn't make (uploads with progress, workers). */
export async function idToken(): Promise<string | null> {
  return auth?.currentUser ? auth.currentUser.getIdToken() : null
}

export async function signOut() {
  if (auth) await fbSignOut(auth)
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    () => state,
  )
}

function friendly(code: string, message: string): string {
  if (code === 'auth/unauthorized-domain') return `This address isn't allowed to sign in yet: add ${location.hostname} under Firebase → Authentication → Settings → Authorized domains.`
  if (code === 'auth/operation-not-allowed') return 'Google sign-in is turned off in this Firebase project: enable it under Authentication → Sign-in method.'
  if (code === 'auth/network-request-failed') return 'Could not reach Google. Check your internet connection.'
  return message.replace(/^Firebase: /, '')
}

/** Every request to the analyzer (/api/…) carries the signed-in user's Google ID token. */
function installApiAuth() {
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
    const user = auth?.currentUser
    if (url.origin === location.origin && url.pathname.startsWith('/api/') && user) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      headers.set('Authorization', `Bearer ${await user.getIdToken()}`)
      return original(input, { ...init, headers })
    }
    return original(input, init)
  }
}
