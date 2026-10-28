// App-like behaviour: switch off browser defaults that make a web page feel
// like a document (zoom, text selection, focus sticking to clicked buttons,
// context menus, dragging, accidental file-drop navigation).

let installed = false

export function installGuards() {
  if (installed) return
  installed = true
  const isTextField = (t: EventTarget | null) =>
    !!(t as Element | null)?.closest?.('input:not([type=range]), textarea, [contenteditable="true"]')

  // No page zoom: ctrl/⌘ +/−/0, pinch (ctrl+wheel) and Safari gestures.
  // The graph handles its own ctrl+wheel to zoom the timeline.
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.metaKey || e.ctrlKey) && ['+', '=', '-', '_', '0'].includes(e.key)) e.preventDefault()
    },
    true,
  )
  window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false })
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend'])
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false } as AddEventListenerOptions)

  // Clicking a button must not leave it focused (otherwise space/enter "press" it again).
  document.addEventListener(
    'mousedown',
    (e) => {
      if ((e.target as Element).closest?.('button, [role="button"], a') && !isTextField(document.activeElement)) e.preventDefault()
    },
    true,
  )
  // Touch screens: a slider moves to wherever you touch its bar and follows the finger
  // (on its own, a phone's slider only reacts to a touch right on its small thumb).
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = e.target as HTMLInputElement
      if (e.pointerType !== 'touch' || !(el instanceof HTMLInputElement) || el.type !== 'range' || el.disabled) return
      e.preventDefault()
      const set = (x: number) => {
        const r = el.getBoundingClientRect()
        const min = Number(el.min || 0), max = Number(el.max || 100), step = Number(el.step) || 1
        const frac = Math.min(1, Math.max(0, (x - r.left) / r.width))
        const v = Math.round((min + frac * (max - min)) / step) * step
        // React listens to the native setter + an input event
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v))
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set(e.clientX)
      const move = (ev: PointerEvent) => ev.pointerId === e.pointerId && set(ev.clientX)
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    true,
  )

  // Sliders: release focus once you let go, so arrow keys go back to the shortcuts.
  document.addEventListener('pointerup', () => {
    const a = document.activeElement
    if (a instanceof HTMLInputElement && a.type === 'range') a.blur()
  })

  // The browser's right-click menu stays available (Inspect, etc.).
  // No element dragging or text-drag (except in text fields).
  document.addEventListener('dragstart', (e) => !isTextField(e.target) && e.preventDefault())
  // Dropping a file outside a drop zone must not navigate away from the app.
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => e.preventDefault())
}
