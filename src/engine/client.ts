// Main-thread handle to the audio engine. Owns the AudioContext and the
// AudioWorkletNode; never touches WASM directly (the worklet does).
import type { DrumPattern, FromWorklet, Pattern, ToWorklet } from "./protocol"
// `?worker&url` makes Vite compile worklet.ts (and its imports) to a standalone
// JS module and give us its URL: in dev a transformed module, in build a
// hashed file in dist/assets. AudioWorklet.addModule needs exactly that.
import workletUrl from "./worklet.ts?worker&url"
import wasmUrl from "./osc8.wasm?url"

export type StepListener = (step: number) => void

// Messages not yet in protocol.ts (the lead will move them there).
/** Main thread -> worklet: mod wheel position, 0..1. */
/** @deprecated now part of ToWorklet in protocol.ts */
export type ToWorkletMod = Extract<ToWorklet, { type: "modwheel" }>
/**
 * Worklet -> main thread, ~30 Hz while any mod route is live, plus one final
 * message with `active: false` when the last route goes away.
 * `values[id]` is the current effective value of param `id` (0..163) in its
 * engineering units: knob value plus modulation from the most recently
 * triggered note, clamped to the target range. Untargeted params hold their knob value.
 */
/** @deprecated now part of FromWorklet in protocol.ts */
export type FromWorkletMod = Extract<FromWorklet, { type: "mod" }>
export type ModListener = (values: Float32Array | null) => void

export class EngineClient {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private starting: Promise<void> | null = null
  private stepListeners = new Set<StepListener>()
  private modListeners = new Set<ModListener>()

  /** The running AudioContext, once started. */
  get context(): AudioContext | null {
    return this.ctx
  }

  /** The engine's output node (connected to the destination), once started. */
  get output(): AudioNode | null {
    return this.node
  }

  get started(): boolean {
    return this.node !== null
  }

  /**
   * Create the AudioContext, load the worklet and WASM, and wait for the engine
   * to report ready. Call from a user gesture (autoplay policy). Idempotent.
   */
  start(): Promise<void> {
    this.starting ??= this.boot().catch((err) => {
      this.starting = null
      void this.close()
      throw err
    })
    return this.starting
  }

  private async boot() {
    // Created synchronously inside the gesture so the context may start running.
    const ctx = new AudioContext({ latencyHint: "interactive" })
    this.ctx = ctx
    const resumed = ctx.state === "running" ? Promise.resolve() : ctx.resume()
    const [wasm] = await Promise.all([
      fetch(wasmUrl).then((r) => {
        if (!r.ok) throw new Error(`osc8.wasm: HTTP ${r.status}`)
        return r.arrayBuffer()
      }),
      ctx.audioWorklet.addModule(workletUrl),
      resumed,
    ])
    const node = new AudioWorkletNode(ctx, "osc8", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    const ready = new Promise<void>((resolve, reject) => {
      node.port.onmessage = (e: MessageEvent<FromWorklet | FromWorkletMod>) => {
        const msg = e.data
        if (msg.type === "ready") resolve()
        else if (msg.type === "error") reject(new Error(`osc8 engine: ${msg.message}`))
        else if (msg.type === "step") for (const cb of this.stepListeners) cb(msg.step)
        else if (msg.type === "mod") for (const cb of this.modListeners) cb(msg.active ? msg.values : null)
      }
      node.onprocessorerror = () => reject(new Error("osc8 engine: processor error"))
    })
    node.connect(ctx.destination)
    this.node = node
    this.post({ type: "init", wasm }, [wasm])
    await ready
  }

  private post(msg: ToWorklet | ToWorkletMod, transfer: Transferable[] = []) {
    this.node?.port.postMessage(msg, transfer)
  }

  /** Send `(paramId, value)` pairs (see params.ts). */
  setParams(pairs: [id: number, value: number][]) {
    if (pairs.length) this.post({ type: "params", params: pairs })
  }

  setPattern(pattern: Pattern) {
    this.post({ type: "pattern", pattern })
  }

  setTransport(playing: boolean, bpm: number) {
    this.post({ type: "transport", playing, bpm })
  }

  noteOn(note: number, velocity = 1) {
    this.post({ type: "noteOn", note, velocity })
  }

  noteOff(note: number) {
    this.post({ type: "noteOff", note })
  }

  /** Subscribe to playhead changes (-1 when stopped). Returns an unsubscribe function. */
  onStep(cb: StepListener): () => void {
    this.stepListeners.add(cb)
    return () => {
      this.stepListeners.delete(cb)
    }
  }

  /**
   * Subscribe to modulated param values (~30 Hz while any mod route is live).
   * `values[id]` is param `id`'s effective value (ids 0..163); `null` means no
   * route is live any more. Returns an unsubscribe function.
   */
  onMod(cb: ModListener): () => void {
    this.modListeners.add(cb)
    return () => {
      this.modListeners.delete(cb)
    }
  }

  /** Mod wheel position, 0..1 (a modulation source). */
  setModwheel(value: number) {
    this.post({ type: "modwheel", value })
  }

  /** Replace the 808 track's pattern. Kit params go through `setParams` (drums.ts kitToParams). */
  setDrumPattern(pattern: DrumPattern) {
    this.post({ type: "drumPattern", pattern })
  }

  /** Audition one drum voice now, regardless of transport. `voice` = index into DRUM_VOICES. */
  triggerDrum(voice: number, velocity = 0.8) {
    this.post({ type: "drumTrigger", voice, velocity })
  }

  /** Tear down the node and context. The client can be started again afterwards. */
  async close() {
    const { node, ctx } = this
    this.node = null
    this.ctx = null
    this.starting = null
    if (node) {
      node.port.onmessage = null
      node.disconnect()
    }
    if (ctx && ctx.state !== "closed") await ctx.close()
  }
}
