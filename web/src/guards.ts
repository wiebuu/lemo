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
