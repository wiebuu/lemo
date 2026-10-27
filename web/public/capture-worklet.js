// AudioWorklet: copies mic samples off the audio thread in 512-sample hops,
// stamped with the exact frame index. No analysis here — keeps the audio
// thread glitch-free. Pitch detection runs in a Web Worker; while a take is
// being recorded (for "hear yourself"), a copy also goes to the page.
class LemoCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.hop = 512
    this.buf = new Float32Array(this.hop)
    this.fill = 0
    this.out = null
    this.rec = null
    this.recording = false
    this.port.onmessage = (e) => {
      const d = e.data || {}
      if (d.port) this.out = d.port
      if (d.recPort) this.rec = d.recPort
      if (typeof d.record === 'boolean') this.recording = d.record
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch || !this.out) return true
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.fill++] = ch[i]
      if (this.fill === this.hop) {
        // frame index of the last sample in this hop
        const endFrame = currentFrame + i + 1
        if (this.recording && this.rec) this.rec.postMessage({ samples: this.buf.slice(), endFrame })
        this.out.postMessage({ samples: this.buf, endFrame }, [this.buf.buffer])
        this.buf = new Float32Array(this.hop)
        this.fill = 0
      }
    }
    return true
  }
}
registerProcessor('lemo-capture', LemoCapture)
