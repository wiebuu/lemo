// "Analyse on this device": instead of waiting in the server's queue, this phone or
// computer separates the vocals and tracks their pitch itself (same models as the
// server), then uploads the result. The server checks it before keeping it, and from
// then on the song opens instantly for everyone. Nothing stays on the device except
// the two models, which the browser keeps so the next song starts straight away.

import { ApiError } from '../api/analyzer'
import { apiUrl, idToken } from '../auth/firebase'
import type { WorkerIn, WorkerOut } from './analysis.worker'

export type DeviceStage = 'models' | 'fetching' | 'separating' | 'melody' | 'encoding' | 'uploading' | 'checking' | 'finishing'

export interface DeviceProgress {
  stage: DeviceStage
  /** 0..1 over the whole analysis */
  progress: number
  detail: string
  /** seconds left, once it can be measured */
  eta: number | null
  title?: string | null
}

/** Rough share of the whole job each step takes (on a typical laptop). */
const SPAN: Record<DeviceStage, [number, number]> = {
  models: [0, 0.08],
  fetching: [0.08, 0.13],
  separating: [0.13, 0.55],
  melody: [0.55, 0.85],
  encoding: [0.85, 0.9],
  uploading: [0.9, 0.95],
  checking: [0.95, 0.97],
  finishing: [0.97, 1],
}

const MODELS = { demucs: 'htdemucs.onnx', crepe: 'crepe-full.onnx' } as const
const MODEL_MB = { demucs: 174, crepe: 89 }
const CACHE = 'lemody-models-v1'

export interface DeviceSupport {
  ok: boolean
  /** why not, in words */
  why?: string
  phone: boolean
}

let support: Promise<DeviceSupport> | null = null

/** Can this device analyse songs itself? Needs WebGPU (the graphics chip, from the browser). */
export function deviceSupport(): Promise<DeviceSupport> {
  support ??= (async () => {
    const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ limits: { maxBufferSize: number } } | null> } }).gpu
    if (!gpu) return { ok: false, phone, why: 'This browser can’t use the graphics chip (WebGPU).' }
    try {
      const adapter = await gpu.requestAdapter()
      if (!adapter) return { ok: false, phone, why: 'No graphics chip available to the browser.' }
      if (adapter.limits.maxBufferSize < 256 * 2 ** 20) return { ok: false, phone, why: 'The graphics chip is too small for the analysis.' }
    } catch {
      return { ok: false, phone, why: 'The graphics chip isn’t available.' }
    }
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    if (mem !== undefined && mem < 4) return { ok: false, phone, why: 'This device has too little memory.' }
    return { ok: true, phone }
  })()
  return support
}

/** Already downloaded once? (then the next song starts right away) */
export async function modelsReady(): Promise<boolean> {
  try {
    const c = await caches.open(CACHE)
    return (await Promise.all(Object.values(MODELS).map((m) => c.match(`/models/${m}`)))).every(Boolean)
  } catch {
    return false
  }
}

async function model(name: string, onBytes: (got: number) => void, signal: AbortSignal): Promise<ArrayBuffer> {
  const key = `/models/${name}`
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE)
    const hit = await cache.match(key)
    if (hit) {
      const buf = await hit.arrayBuffer()
      onBytes(buf.byteLength)
      return buf
    }
  } catch {
    /* no cache storage (private window): download every time */
  }
  const res = await fetch(`/api/models/${name}`, { signal })
  if (!res.ok || !res.body) throw new Error(`Couldn't download the analyser (${res.status}).`)
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    onBytes(got)
  }
  const buf = new Uint8Array(got)
  let o = 0
  for (const p of parts) {
    buf.set(p, o)
    o += p.length
  }
  try {
    await cache?.put(key, new Response(buf.slice().buffer))
  } catch {
    /* cache full: fine, it downloads again next time */
  }
  return buf.buffer
}

async function json<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>
  let msg = `${res.status}`
  let code: string | undefined
  try {
    const body = await res.json()
    const d = body.detail
    msg = typeof d === 'string' ? d : d?.message ?? msg
    code = typeof d === 'object' ? d?.code : undefined
  } catch {
    /* not json */
  }
  throw new ApiError(msg, res.status, code)
}

interface ServerState {
  id: string
  state: 'fetching' | 'ready' | 'checking' | 'finishing' | 'done' | 'failed' | 'server'
  progress: number
  message: string
  title?: string | null
  duration?: number | null
  error?: string | null
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('stopped', 'AbortError'))), { once: true })
  })

const RATE_KEY = 'lemody.deviceRate'

/** How long this device takes per second of song (measured on its last analysis; a guess before that). */
export function deviceRate(phone: boolean): number {
  try {
    const r = Number(localStorage.getItem(RATE_KEY))
    if (r > 0.2 && r < 20) return r
  } catch {
    /* blocked */
  }
  return phone ? 3 : 1.5
}

export type DeviceResult = { kind: 'done'; id: string } | { kind: 'server'; id: string }

/**
 * Analyse a song here: a YouTube link, or the singer's own audio file. Resolves with
 * the song id when it's stored (or { kind: 'server' } if the server was already
 * analysing it).
 */
export async function analyseOnDevice(source: string | File, onProgress: (p: DeviceProgress) => void, signal: AbortSignal): Promise<DeviceResult> {
  const started = performance.now()
  let title: string | null | undefined = typeof source === 'string' ? undefined : source.name.replace(/\.[^.]+$/, '')
  let stage: DeviceStage = 'models'
  const report = (s: DeviceStage, frac: number, detail: string, eta: number | null = null) => {
    stage = s
    const [lo, hi] = SPAN[s]
    onProgress({ stage: s, progress: lo + (hi - lo) * Math.max(0, Math.min(1, frac)), detail, eta, title })
  }

  // 1. the server gets the song (no queue), or keeps the singer's file to check the result
  // against — meanwhile the models download (first time only)
  let start: ServerState
  if (typeof source === 'string') {
    start = await json<ServerState>(await fetch('/api/songs/device/start', { method: 'POST', body: new URLSearchParams({ url: source }), signal }))
  } else {
    const fd = new FormData()
    fd.append('file', source)
    start = await upload('/api/songs/device/upload', fd, (frac) => report('fetching', frac * 0.3, `sending your song · ${Math.round(frac * 100)}%`), signal)
    report('models', 0, 'getting the analyser')
  }
  if (start.state === 'done') return { kind: 'done', id: start.id }
  if (start.state === 'server') return { kind: 'server', id: start.id }
  const id = start.id

  const got = { demucs: 0, crepe: 0 }
  const totalMb = MODEL_MB.demucs + MODEL_MB.crepe
  const showModels = () => {
    const mb = (got.demucs + got.crepe) / 2 ** 20
    if (stage === 'models') report('models', mb / totalMb, mb < totalMb - 1 ? `getting the analyser · ${Math.round(mb)} / ${totalMb} MB (first time only)` : 'analyser ready')
  }
  const models = Promise.all([
    model(MODELS.demucs, (b) => ((got.demucs = b), showModels()), signal),
    model(MODELS.crepe, (b) => ((got.crepe = b), showModels()), signal),
  ])

  let st = start
  while (st.state === 'fetching') {
    await sleep(700, signal)
    st = await json<ServerState>(await fetch(`/api/songs/device/${id}`, { signal }))
    title = st.title ?? title
  }
  if (st.state === 'failed') throw new Error(st.error ?? 'Couldn’t get the song.')
  title = st.title ?? title
  const [demucs, crepe] = await models
  report('fetching', 0.3, 'getting the song')
  const res = await fetch(`/api/songs/device/${id}/audio`, { signal })
  if (!res.ok) throw new Error(`Couldn’t get the song (${res.status}).`)
  report('fetching', 0.7, 'reading the song')
  const ctx = new OfflineAudioContext(2, 1, 44100)
  const decoded = await ctx.decodeAudioData(await res.arrayBuffer())
  const channels = [decoded.getChannelData(0).slice(), (decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decoded.getChannelData(0)).slice()]
  const duration = decoded.duration

  // 2. the heavy part, on this device
  const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
  const stopWorker = () => worker.postMessage({ type: 'stop' } satisfies WorkerIn)
  signal.addEventListener('abort', stopWorker, { once: true })
  const stageStart: Partial<Record<DeviceStage, number>> = {}
  let result: Extract<WorkerOut, { type: 'done' }>
  try {
    result = await new Promise((resolve, reject) => {
      worker.onerror = (e) => reject(new Error(e.message || 'The analysis stopped unexpectedly.'))
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data
        if (m.type === 'error') return reject(m.message === 'stopped' ? new DOMException('stopped', 'AbortError') : new Error(m.message))
        if (m.type === 'done') return resolve(m)
        const t = performance.now()
        stageStart[m.stage] ??= t
        const frac = m.total ? m.done / m.total : 0
        const spent = (t - stageStart[m.stage]!) / 1000
        // time left: this step's measured pace, plus the steps after it at the usual ratio
        const thisLeft = frac > 0.04 ? (spent / frac) * (1 - frac) : null
        const after = m.stage === 'separating' && thisLeft !== null ? (spent / frac) * 0.75 : 0
        const eta = thisLeft === null ? null : thisLeft + after + 15
        const label = m.stage === 'separating' ? 'separating the vocals' : m.stage === 'melody' ? 'finding the melody' : 'preparing the upload'
        report(m.stage, frac, `${label} · ${Math.round(frac * 100)}%`, eta)
      }
      worker.postMessage({ type: 'start', channels, demucs, crepe } satisfies WorkerIn, [...channels.map((c) => c.buffer), demucs, crepe])
    })
  } finally {
    signal.removeEventListener('abort', stopWorker)
    worker.terminate()
  }

  // 3. upload; the server checks it, then finishes the song like any other
  const fd = new FormData()
  fd.append('vocals', new Blob([result.vocals]), `vocals${result.ext}`)
  fd.append('backing', new Blob([result.music]), `backing${result.ext}`)
  fd.append('f0', new Blob([result.f0.buffer as ArrayBuffer]), 'f0.f32')
  fd.append('periodicity', new Blob([result.periodicity.buffer as ArrayBuffer]), 'periodicity.f32')
  const sent = await upload(`/api/songs/device/${id}/result`, fd, (frac) => report('uploading', frac, `uploading · ${Math.round(frac * 100)}%`), signal)
  st = sent
  while (st.state !== 'done') {
    if (st.state === 'failed') throw new Error(st.error ?? 'The server couldn’t finish the song.')
    report(st.state === 'checking' ? 'checking' : 'finishing', st.progress, st.state === 'checking' ? 'checking the result' : st.message || 'finishing up')
    await sleep(800, signal)
    st = await json<ServerState>(await fetch(`/api/songs/device/${id}`, { signal }))
  }
  const took = (performance.now() - started) / 1000
  try {
    if (duration > 30) localStorage.setItem(RATE_KEY, String(took / duration)) // next time's estimate
  } catch {
    /* blocked */
  }
  return { kind: 'done', id }
}

/** fetch() can't report upload progress: XMLHttpRequest can. */
async function upload(url: string, body: FormData, onFrac: (f: number) => void, signal: AbortSignal): Promise<ServerState> {
  const token = await idToken()
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', apiUrl(url))
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => e.lengthComputable && onFrac(e.loaded / e.total)
    xhr.onload = () => {
      let data: { detail?: string | { message?: string; code?: string } } & Partial<ServerState> = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        /* not json */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data as ServerState)
      const d = data.detail
      reject(new ApiError(typeof d === 'string' ? d : d?.message ?? `Upload failed (${xhr.status})`, xhr.status, typeof d === 'object' ? d?.code : undefined))
    }
    xhr.onerror = () => reject(new Error('The upload failed — check your connection.'))
    signal.addEventListener('abort', () => (xhr.abort(), reject(new DOMException('stopped', 'AbortError'))), { once: true })
    xhr.send(body)
  })
}
