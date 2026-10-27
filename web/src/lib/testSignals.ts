// Synthetic test signals with known pitch, shared by unit tests and the
// in-app self-check. Deterministic (seeded noise).

export function sine(freq: number, sampleRate: number, length: number, amp = 0.5, phase = 0): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = amp * Math.sin(phase + (2 * Math.PI * freq * i) / sampleRate)
  return out
}

/** Voice-like tone: fundamental + decaying harmonics. */
export function harmonicTone(freq: number, sampleRate: number, length: number, amp = 0.4): Float32Array {
  const out = new Float32Array(length)
  const weights = [1, 0.6, 0.35, 0.2, 0.1]
  for (let h = 0; h < weights.length; h++) {
    const f = freq * (h + 1)
    if (f > sampleRate / 2) break
    for (let i = 0; i < length; i++) out[i] += amp * weights[h] * Math.sin((2 * Math.PI * f * i) / sampleRate)
  }
  return out
}

export function noise(length: number, amp = 0.3, seed = 1): Float32Array {
  const out = new Float32Array(length)
  let s = seed
  for (let i = 0; i < length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out[i] = amp * ((s / 0xffffffff) * 2 - 1)
  }
  return out
}

export function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] ?? 0)
  return out
}
