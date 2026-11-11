// Progressive loading of a stem: the song opens after its first few seconds have
// arrived and the rest fills in while you sing — like a video that starts before
// it has finished downloading.
//
// Stems are AAC in .m4a with the index (moov) at the front (ffmpeg +faststart). The
// index says where every audio frame sits in the file, so frames are handed to the
// browser's own AAC decoder (WebCodecs) as their bytes arrive, and written into one
// song-length AudioBuffer. Browsers without WebCodecs, or a file laid out
// differently, fall back to downloading the whole file and decoding it in one go.

type Listener = () => void

/** A stem's audio, possibly still filling in. */
export interface StemTrack {
  buffer: AudioBuffer
  /** Seconds of `buffer` (from its start) that hold decoded audio. */
  loaded: number
  done: boolean
  subscribe(fn: Listener): () => void
}

/** Audio that's already all there. */
export function wholeTrack(buffer: AudioBuffer): StemTrack {
  return { buffer, loaded: buffer.duration, done: true, subscribe: () => () => {} }
}

class Track implements StemTrack {
  buffer!: AudioBuffer
  loaded = 0
  done = false
  error: Error | null = null
  private listeners = new Set<Listener>()
  private lastEmit = -1
  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  /** Tell listeners — every quarter second of new audio is plenty. */
  emit(force = false) {
    if (!force && this.loaded - this.lastEmit < 0.25) return
    this.lastEmit = this.loaded
    this.listeners.forEach((l) => l())
  }
}

/**
 * Start streaming one stem. Resolves once its buffer exists (the first frames are
 * decoded); `loaded` then grows until `done`. `onBytes` reports the download.
 */
export async function streamStem(
  ctx: BaseAudioContext,
  res: Response,
  signal: AbortSignal,
  onBytes: (got: number, total: number) => void,
): Promise<StemTrack> {
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body?.getReader()
  if (!reader || typeof AudioDecoder === 'undefined') return wholeTrack(await ctx.decodeAudioData(await res.arrayBuffer()))

  let data = new Uint8Array(total || 1 << 20)
  let got = 0
  const append = (chunk: Uint8Array) => {
    if (got + chunk.length > data.length) {
      const bigger = new Uint8Array(Math.max(data.length * 2, got + chunk.length))
      bigger.set(data.subarray(0, got))
      data = bigger
    }
    data.set(chunk, got)
    got += chunk.length
    onBytes(got, total)
  }
  const readMore = async () => {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const { done, value } = await reader.read()
    if (value) append(value)
    return !done
  }
  const readAll = async () => {
    while (await readMore()) {
      /* keep reading */
    }
    return data.slice(0, got).buffer
  }
  const whole = async () => wholeTrack(await ctx.decodeAudioData(await readAll()))

  // 1. The index: top-level boxes until "moov". Audio data ("mdat") first → not streamable.
  let pos = 0
  let index: Index | null = null
  for (;;) {
    while (got < pos + 16) if (!(await readMore())) return whole()
    const v = new DataView(data.buffer, data.byteOffset)
    let size = v.getUint32(pos)
    const type = fourcc(data, pos + 4)
    if (size === 1) size = Number(v.getBigUint64(pos + 8))
    if (type === 'mdat' || size < 8) return whole()
    if (type === 'moov') {
      while (got < pos + size) if (!(await readMore())) return whole()
      index = parseMoov(data.subarray(pos + 8, pos + size))
      break
    }
    pos += size
  }
  if (!index) return whole()
  const config: AudioDecoderConfig = {
    codec: index.codec,
    sampleRate: index.sampleRate,
    numberOfChannels: index.channels,
    description: index.asc,
  }
  try {
    if (!(await AudioDecoder.isConfigSupported(config)).supported) return whole()
  } catch {
    return whole()
  }

  // 2. Decode frames as they arrive, straight into a song-length buffer.
  const track = new Track()
  const ix = index
  let written = 0 // decoded frames so far, priming included
  let skip = 0 // priming frames, in the decoder's output rate
  let length = 0
  let firstOut: (() => void) | null = null
  const ready = new Promise<void>((r) => (firstOut = r))
  let failed = false
  const decoder = new AudioDecoder({
    output: (ad) => {
      try {
        if (!track.buffer) {
          const rate = ad.sampleRate
          skip = Math.round((ix.priming * rate) / ix.timescale)
          length = Math.max(1, Math.round((ix.length * rate) / ix.timescale))
          track.buffer = ctx.createBuffer(ad.numberOfChannels, length, rate)
          firstOut?.()
        }
        const n = ad.numberOfFrames
        const from = Math.max(0, skip - written) // drop the priming
        const at = written + from - skip
        const count = Math.min(n - from, length - at)
        if (count > 0) {
          const tmp = new Float32Array(n)
          for (let ch = 0; ch < track.buffer.numberOfChannels; ch++) {
            ad.copyTo(tmp, { planeIndex: Math.min(ch, ad.numberOfChannels - 1), format: 'f32-planar' })
            track.buffer.copyToChannel(tmp.subarray(from, from + count), ch, at)
          }
        }
        written += n
        track.loaded = Math.max(0, Math.min(length, written - skip)) / track.buffer.sampleRate
        track.emit()
      } finally {
        ad.close()
      }
    },
    error: () => {
      failed = true
      firstOut?.()
    },
  })
  decoder.configure(config)

  let next = 0
  const feed = () => {
    while (next < ix.offsets.length && ix.offsets[next] + ix.sizes[next] <= got && !failed) {
      const off = ix.offsets[next]
      decoder.decode(new EncodedAudioChunk({
        type: 'key',
        timestamp: Math.round((ix.times[next] * 1e6) / ix.timescale),
        data: data.subarray(off, off + ix.sizes[next]),
      }))
      next++
    }
  }

  const finish = async () => {
    if (!failed) await decoder.flush().catch(() => void (failed = true))
    if (decoder.state !== 'closed') decoder.close()
    if (failed || !track.buffer) {
      // the decoder gave up part-way: decode the whole file the usual way
      const buf = await ctx.decodeAudioData(data.slice(0, got).buffer)
      track.buffer = buf
      track.loaded = buf.duration
    } else {
      track.loaded = track.buffer.duration
    }
    track.done = true
    track.emit(true)
  }

  const pump = async () => {
    try {
      feed()
      while (await readMore()) feed()
      feed()
      await finish()
    } catch (e) {
      if (decoder.state !== 'closed') decoder.close()
      track.error = e as Error
      track.emit(true)
    }
  }
  void pump()
  await ready
  if (failed && !track.buffer) {
    await new Promise<void>((r) => {
      const off = track.subscribe(() => (track.done || track.error) && (off(), r()))
    })
    if (track.error) throw track.error
  }
  return track
}

// ---- the .m4a index ---------------------------------------------------------

interface Index {
  codec: string
  sampleRate: number
  channels: number
  asc: Uint8Array
  timescale: number
  /** priming to drop and the song's length, in `timescale` units */
  priming: number
  length: number
  offsets: number[]
  sizes: number[]
  times: number[]
}

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])

/** Child boxes of a box's payload. */
function boxes(b: Uint8Array): Map<string, Uint8Array[]> {
  const out = new Map<string, Uint8Array[]>()
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let p = 0
  while (p + 8 <= b.length) {
    let size = v.getUint32(p)
    const type = fourcc(b, p + 4)
    let head = 8
    if (size === 1) {
      size = Number(v.getBigUint64(p + 8))
      head = 16
    } else if (size === 0) size = b.length - p
    if (size < head || p + size > b.length) break
    const list = out.get(type) ?? []
    list.push(b.subarray(p + head, p + size))
    out.set(type, list)
    p += size
  }
  return out
}

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

function parseMoov(moov: Uint8Array): Index | null {
  const top = boxes(moov)
  const mvhd = top.get('mvhd')?.[0]
  if (!mvhd) return null
  const movieScale = dv(mvhd).getUint32(mvhd[0] === 1 ? 20 : 12)
  for (const trak of top.get('trak') ?? []) {
    const t = boxes(trak)
    const mdia = t.get('mdia')?.[0]
    if (!mdia) continue
    const m = boxes(mdia)
    const hdlr = m.get('hdlr')?.[0]
    if (!hdlr || fourcc(hdlr, 8) !== 'soun') continue
    const mdhd = m.get('mdhd')![0]
    const mv = dv(mdhd)
    const timescale = mv.getUint32(mdhd[0] === 1 ? 20 : 12)
    const mediaDur = mdhd[0] === 1 ? Number(mv.getBigUint64(24)) : mv.getUint32(16)
    const stbl = boxes(boxes(m.get('minf')![0]).get('stbl')![0])

    // codec: mp4a sample entry → esds → AudioSpecificConfig
    const stsd = stbl.get('stsd')![0]
    const entry = stsd.subarray(8) // fullbox header + entry count
    if (fourcc(entry, 4) !== 'mp4a') return null
    const ev = dv(entry)
    const channels = ev.getUint16(8 + 16)
    const sampleRate = ev.getUint32(8 + 24) >>> 16
    const esds = boxes(entry.subarray(8 + 28, ev.getUint32(0))).get('esds')?.[0]
    const asc = esds && findDescriptor(esds.subarray(4), 5)
    if (!asc?.length) return null
    const aot = asc[0] >> 3
    const codec = `mp4a.40.${aot}`

    // where each frame sits
    const sizes = sampleSizes(stbl.get('stsz')![0])
    const chunkOffsets = stbl.get('stco')?.[0] ? u32Table(stbl.get('stco')![0]) : u64Table(stbl.get('co64')![0])
    const stsc = stbl.get('stsc')![0]
    const sv = dv(stsc)
    const runs = sv.getUint32(4)
    const offsets: number[] = []
    let s = 0
    for (let r = 0; r < runs; r++) {
      const first = sv.getUint32(8 + r * 12) - 1
      const per = sv.getUint32(12 + r * 12)
      const last = r + 1 < runs ? sv.getUint32(8 + (r + 1) * 12) - 1 : chunkOffsets.length
      for (let c = first; c < last && s < sizes.length; c++) {
        let off = chunkOffsets[c]
        for (let k = 0; k < per && s < sizes.length; k++, s++) {
          offsets.push(off)
          off += sizes[s]
        }
      }
    }
    if (offsets.length !== sizes.length) return null
    const times: number[] = []
    const stts = dv(stbl.get('stts')![0])
    let tm = 0
    for (let e = 0, n = stts.getUint32(4); e < n; e++) {
      const count = stts.getUint32(8 + e * 8)
      const delta = stts.getUint32(12 + e * 8)
      for (let k = 0; k < count && times.length < sizes.length; k++, tm += delta) times.push(tm)
    }
    while (times.length < sizes.length) times.push(tm)

    // the edit list: encoder priming to skip, and how long the song really is
    let priming = 0
    let length = mediaDur
    const elst = t.get('edts') && boxes(t.get('edts')![0]).get('elst')?.[0]
    if (elst) {
      const el = dv(elst)
      const v1 = elst[0] === 1
      for (let e = 0, n = el.getUint32(4); e < n; e++) {
        const at = 8 + e * (v1 ? 20 : 12)
        const segDur = v1 ? Number(el.getBigUint64(at)) : el.getUint32(at)
        const mediaTime = v1 ? Number(el.getBigInt64(at + 8)) : el.getInt32(at + 4)
        if (mediaTime < 0) continue // an empty edit
        priming = mediaTime
        length = segDur ? Math.round((segDur * timescale) / movieScale) : mediaDur - mediaTime
        break
      }
    }
    return { codec, sampleRate, channels, asc: asc.slice(), timescale, priming, length, offsets, sizes, times }
  }
  return null
}

function sampleSizes(stsz: Uint8Array): number[] {
  const v = dv(stsz)
  const fixed = v.getUint32(4)
  const n = v.getUint32(8)
  return Array.from({ length: n }, (_, i) => (fixed ? fixed : v.getUint32(12 + i * 4)))
}
const u32Table = (b: Uint8Array) => Array.from({ length: dv(b).getUint32(4) }, (_, i) => dv(b).getUint32(8 + i * 4))
const u64Table = (b: Uint8Array) => Array.from({ length: dv(b).getUint32(4) }, (_, i) => Number(dv(b).getBigUint64(8 + i * 8)))

/** The payload of the first MPEG-4 descriptor with this tag (ES → DecoderConfig → DecSpecificInfo). */
function findDescriptor(b: Uint8Array, want: number): Uint8Array | null {
  let p = 0
  while (p < b.length) {
    const tag = b[p++]
    let len = 0
    for (let i = 0; i < 4; i++) {
      const c = b[p++]
      len = (len << 7) | (c & 0x7f)
      if (!(c & 0x80)) break
    }
    const body = b.subarray(p, p + len)
    if (tag === want) return body
    if (tag === 3) {
      // ES_Descriptor: ES_ID, flags, then optional fields before its children
      const flags = body[2]
      let q = 3
      if (flags & 0x80) q += 2
      if (flags & 0x40) q += 1 + body[q]
      if (flags & 0x20) q += 2
      return findDescriptor(body.subarray(q), want)
    }
    if (tag === 4) return findDescriptor(body.subarray(13), want) // DecoderConfig: 13 fixed bytes, then children
    p += len
  }
  return null
}
