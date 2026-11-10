import { useState } from 'react'
import { go } from '../pages/router'

const KEY = 'lemo.cookieNote'

/** A one-time, one-line note about cookies (sign-in and ads), in the footer — in the page's
 * own flow, so it never covers anything. Gone for good once closed.
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
    <div role="note" className="fade-in basis-full sm:basis-auto w-full max-w-md mx-auto mb-1.5 flex items-center gap-3 rounded-full bg-sub-alt text-sub text-[11px] pl-4 pr-1.5 py-1">
      <span className="flex-1">
        Lemody uses cookies for sign-in and ads. <a href="/privacy" onClick={go} className="underline underline-offset-2 hover:text-text">Privacy</a>
      </span>
      <button type="button" onClick={close} className="rounded-full bg-main text-bg font-medium px-3 py-1">OK</button>
    </div>
  )
}
