// AudioWorkletProcessor hosting the Rust engine (osc8.wasm).
// Runs in AudioWorkletGlobalScope: no DOM, no fetch. The main thread sends the
// compiled bytes in an "init" message. Keep process() allocation-free.
import type { FromWorklet, ToWorklet } from "./protocol"

// AudioWorkletGlobalScope declarations (not in lib.dom).
declare const sampleRate: number
declare function registerProcessor(name: string, ctor: new (options?: unknown) => AudioWorkletProcessor): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

type Exports = {
  memory: WebAssembly.Memory
  init(sampleRate: number): void
  set_param(id: number, value: number): void
  note_on(note: number, velocity: number): void
  note_off(note: number): void
  set_transport(playing: number, bpm: number): void
  pattern_clear(steps: number): void
  pattern_add(step: number, note: number, length: number, velocity: number): void
  process(frames: number): void
  out_left(): number
  out_right(): number
  current_step(): number
}

const BLOCK = 128

class Osc8Processor extends AudioWorkletProcessor {
  private wasm: Exports | null = null
  private left: Float32Array | null = null
  private right: Float32Array | null = null
  private buffer: ArrayBuffer | null = null
  private lastStep = -1
  /** Messages that arrive while the module is still instantiating. */
  private pending: ToWorklet[] = []

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.receive(e.data)
  }

  private post(msg: FromWorklet) {
    this.port.postMessage(msg)
  }

  private receive(msg: ToWorklet) {
    if (msg.type === "init") {
      void this.load(msg.wasm)
      return
    }
    if (!this.wasm) {
      this.pending.push(msg)
      return
    }
    this.handle(this.wasm, msg)
  }

  private async load(bytes: ArrayBuffer) {
    try {
      const { instance } = await WebAssembly.instantiate(bytes, {})
      const wasm = instance.exports as unknown as Exports
      wasm.init(sampleRate)
      this.wasm = wasm
      this.views()
      for (const m of this.pending) this.handle(wasm, m)
      this.pending = []
      this.post({ type: "ready" })
    } catch (err) {
      this.post({ type: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  /** (Re)create the output views; needed again only if WASM memory grows. */
  private views() {
    const wasm = this.wasm!
    this.buffer = wasm.memory.buffer
    this.left = new Float32Array(this.buffer, wasm.out_left(), BLOCK)
    this.right = new Float32Array(this.buffer, wasm.out_right(), BLOCK)
  }

  private handle(wasm: Exports, msg: ToWorklet) {
    switch (msg.type) {
      case "params":
        for (const [id, value] of msg.params) wasm.set_param(id, value)
        break
      case "pattern":
        wasm.pattern_clear(msg.pattern.steps)
        for (const n of msg.pattern.notes) wasm.pattern_add(n.step, n.note, n.length, n.velocity)
        break
      case "transport":
        wasm.set_transport(msg.playing ? 1 : 0, msg.bpm)
        break
      case "noteOn":
        wasm.note_on(msg.note, msg.velocity)
        break
      case "noteOff":
        wasm.note_off(msg.note)
        break
      case "init":
        break
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    const wasm = this.wasm
    if (!out || out.length === 0) return true
    if (!wasm) {
      for (const ch of out) ch.fill(0)
      return true
    }
    const frames = out[0].length
    for (let offset = 0; offset < frames; offset += BLOCK) {
      const n = Math.min(BLOCK, frames - offset)
      wasm.process(n)
      if (this.buffer !== wasm.memory.buffer) this.views()
      const l = this.left!
      const r = this.right!
      const outL = out[0]
      const outR = out.length > 1 ? out[1] : null
      for (let i = 0; i < n; i++) {
        outL[offset + i] = l[i]
        if (outR) outR[offset + i] = r[i]
      }
    }
    const step = wasm.current_step()
    if (step !== this.lastStep) {
      this.lastStep = step
      this.post({ type: "step", step })
    }
    return true
  }
}

registerProcessor("osc8", Osc8Processor)
