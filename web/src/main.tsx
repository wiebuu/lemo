import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { persist } from './state/persist'
import { installGuards } from './guards'
import { startAuth } from './auth/firebase'
import { AuthGate } from './components/AuthGate'
import { usePath } from './pages/router'

// Apply the saved theme before first paint (the canvas reads its colours on creation).
document.documentElement.dataset.theme = persist.settings().theme
installGuards()
startAuth()

const SitePage = lazy(() => import('./pages/Pages').then((m) => ({ default: m.SitePage })))

/** About, Help, Privacy … open over the app (readable signed in or not); loaded when first opened. */
function Pages() {
  const path = usePath()
  return path === '/' ? null : (
    <Suspense fallback={<div className="fixed inset-0 z-[70] bg-bg" />}>
      <SitePage path={path} />
    </Suspense>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="app">
      <AuthGate>
        <App />
      </AuthGate>
      <Pages />
    </ErrorBoundary>
  </StrictMode>,
)
