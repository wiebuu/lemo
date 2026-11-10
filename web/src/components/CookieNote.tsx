import { useState } from 'react'
import { go } from '../pages/router'

const KEY = 'lemo.cookieNote'

/** A one-time, one-line note about cookies (sign-in and ads). Gone for good once closed.
 * Consent for personalised ads in the EEA/UK is asked by Google's own consent message. */
export function CookieNote() {
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem(KEY)
    } catch {
      return false
    }
  })
  if (!open) return null
  const close = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* private mode: it just shows again next visit */
    }
    setOpen(false)
  }
  return (
    <div role="note" className="fade-in fixed z-[80] bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md flex items-center gap-3 rounded-full bg-sub-alt text-sub text-[11.5px] pl-4 pr-1.5 py-1.5 shadow-lg">
      <span className="flex-1">
        Lemody uses cookies for sign-in and ads. <a href="/privacy" onClick={go} className="underline underline-offset-2 hover:text-text">Privacy</a>
      </span>
      <button type="button" onClick={close} className="rounded-full bg-main text-bg font-medium px-3 py-1">OK</button>
    </div>
  )
}
