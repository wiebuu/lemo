// Where the sound is going: headphones, the device's speaker, or can't tell.
// Browsers only share output device names on some platforms (desktop Chrome /
// Edge, some Android); iPhones don't list outputs at all — that's "unknown".

export type OutputKind = 'headphones' | 'speaker' | 'unknown'

const HEADPHONES =
  /head(phone|set)|ear(phone|bud|pod)s?|airpods|\bbuds\b|bluetooth|\bbt\b|wireless|beats|bose|\bwh-|\bwf-|jbl|sennheiser|jabra|skullcandy|soundcore|nothing ear|galaxy buds|pixel buds|boat|realme|redmi|oneplus|usb audio|external|lightning|type-?c|aux|line out/i
const SPEAKER = /speaker|built-?in|internal|display audio|monitor/i

/** Names a device label (exported for tests). */
export function kindOf(label: string): OutputKind {
  const name = label.replace(/^(default|communications)\s*-\s*/i, '')
  if (HEADPHONES.test(name)) return 'headphones'
  if (SPEAKER.test(name)) return 'speaker'
  return 'unknown'
}

export async function detectOutput(): Promise<OutputKind> {
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.()
    const outs = (devices ?? []).filter((d) => d.kind === 'audiooutput' && d.label)
    if (!outs.length) return 'unknown'
    // the one sound is playing on: "default" (Chrome) or else the first listed
    const current = outs.find((d) => d.deviceId === 'default') ?? outs[0]
    return kindOf(current.label)
  } catch {
    return 'unknown'
  }
}

/** Calls back whenever headphones are plugged in / connected or removed. */
export function onOutputChange(fn: () => void): () => void {
  const md = navigator.mediaDevices
  if (!md?.addEventListener) return () => {}
  md.addEventListener('devicechange', fn)
  return () => md.removeEventListener('devicechange', fn)
}
