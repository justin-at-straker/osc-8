// AudioWorkletProcessor hosting the Rust engine (osc8.wasm).
// Runs in AudioWorkletGlobalScope: no DOM, no fetch. The main thread sends the
// compiled bytes in an "init" message. Keep process() allocation-free.
import type { FromWorklet, ToWorklet } from "./protocol"
import { DRUM_ORDER } from "./drum-order"

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
  set_modwheel(value: number): void
  mod_active(): number
  mod_values_ptr(): number
  drum_pattern_clear(steps: number): void
  drum_pattern_add(step: number, voice: number, velocity: number, accent: number): void
  drum_trigger(voice: number, velocity: number): void
}

const DRUM_INDEX: Record<string, number> = Object.fromEntries(DRUM_ORDER.map((v, i) => [v, i]))

type In = ToWorklet
type Out = FromWorklet

const BLOCK = 128
/** Readback values for every param ID 0..163 (see `mod_values_ptr`). */
const MOD_VALUES = 167
/** Modulation readback rate. */
const MOD_HZ = 30

class Osc8Processor extends AudioWorkletProcessor {
  private wasm: Exports | null = null
  private left: Float32Array | null = null
  private right: Float32Array | null = null
  private buffer: ArrayBuffer | null = null
  private lastStep = -1
  private modValues: Float32Array | null = null
  private modWasActive = false
  private modBlocks = 0
  private readonly modInterval = Math.max(1, Math.round(sampleRate / MOD_HZ / BLOCK))
  /** Messages that arrive while the module is still instantiating. */
  private pending: In[] = []

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<In>) => this.receive(e.data)
  }

  private post(msg: Out) {
    this.port.postMessage(msg)
  }

  private receive(msg: In) {
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
    this.modValues = new Float32Array(this.buffer, wasm.mod_values_ptr(), MOD_VALUES)
  }

  /** At ~30 Hz while any route is live (plus one final message when the last goes away). */
  private postMod(wasm: Exports) {
    if (++this.modBlocks < this.modInterval) return
    this.modBlocks = 0
    const active = wasm.mod_active() !== 0
    if (!active && !this.modWasActive) return
    this.modWasActive = active
    // slice(): a 156-byte copy ~30x/s; the message clone allocates anyway.
    this.post({ type: "mod", active, values: this.modValues!.slice() })
  }

  private handle(wasm: Exports, msg: In) {
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
      case "modwheel":
        wasm.set_modwheel(msg.value)
        break
      case "drumPattern":
        wasm.drum_pattern_clear(msg.pattern.steps)
        for (const h of msg.pattern.hits) {
          const voice = DRUM_INDEX[h.voice]
          if (voice !== undefined) wasm.drum_pattern_add(h.step, voice, h.velocity, h.accent ? 1 : 0)
        }
        break
      case "drumTrigger":
        wasm.drum_trigger(msg.voice, msg.velocity)
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
    this.postMod(wasm)
    return true
  }
}

registerProcessor("osc8", Osc8Processor)
