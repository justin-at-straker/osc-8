/// <reference types="node" />
// Drives the checked-in osc8.wasm through its raw ABI, the same way the worklet does.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { defaultPatch } from "./patch"
import { PARAMS, patchToParams } from "./params"

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

const SR = 48000
let module: WebAssembly.Module

beforeAll(async () => {
  const bytes = readFileSync(join(import.meta.dirname, "osc8.wasm"))
  // Copy into a plain ArrayBuffer of this realm (jsdom swaps some typed-array globals).
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  module = await WebAssembly.compile(buf)
})

async function fresh(): Promise<Exports> {
  const instance = await WebAssembly.instantiate(module, {})
  const e = instance.exports as unknown as Exports
  e.init(SR)
  for (const [id, v] of patchToParams(defaultPatch())) e.set_param(id, v)
  return e
}

/** Render `blocks` x 128 frames and return the left channel. */
function render(e: Exports, blocks: number): Float32Array {
  const out = new Float32Array(blocks * 128)
  for (let b = 0; b < blocks; b++) {
    e.process(128)
    out.set(new Float32Array(e.memory.buffer, e.out_left(), 128), b * 128)
  }
  return out
}

const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
const brightness = (x: Float32Array) => {
  let s = 0
  for (let i = 1; i < x.length; i++) s += (x[i] - x[i - 1]) ** 2
  return s / rms(x) ** 2 / x.length
}
const id = (key: string) => PARAMS.find(([, k]) => k === key)![0]

describe("osc8.wasm", () => {
  it("has no imports and exports the documented ABI", () => {
    expect(WebAssembly.Module.imports(module)).toEqual([])
    const names = WebAssembly.Module.exports(module).map((x) => x.name)
    for (const n of ["memory", "init", "set_param", "note_on", "note_off", "set_transport", "pattern_clear", "pattern_add", "process", "out_left", "out_right", "current_step"]) {
      expect(names).toContain(n)
    }
  })

  it("is silent until a note plays, then non-silent and finite", async () => {
    const e = await fresh()
    expect(rms(render(e, 20))).toBe(0)
    e.note_on(60, 1)
    const out = render(e, 40)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(rms(out)).toBeGreaterThan(0.05)
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(1)
    const right = new Float32Array(e.memory.buffer, e.out_right(), 128)
    expect(rms(right)).toBeGreaterThan(0)
  })

  it("master.volume (id 13) at 0 silences the output", async () => {
    const e = await fresh()
    expect(id("master.volume")).toBe(13)
    e.note_on(60, 1)
    render(e, 10)
    e.set_param(id("master.volume"), 0)
    render(e, 40) // let the smoother settle
    expect(rms(render(e, 10))).toBe(0)
  })

  it("oscA.level (id 2) at 0 silences the output", async () => {
    const e = await fresh()
    e.set_param(id("oscA.level"), 0)
    e.note_on(60, 1)
    render(e, 40)
    expect(rms(render(e, 10))).toBe(0)
  })

  it("lowering filter.cutoff (id 6, Hz) reduces brightness", async () => {
    const measure = async (cutoff: number) => {
      const e = await fresh()
      e.set_param(id("oscA.position"), 0.67) // saw
      e.set_param(id("filter.resonance"), 0)
      e.set_param(id("filter.cutoff"), cutoff)
      e.note_on(48, 1)
      render(e, 20)
      return brightness(render(e, 100))
    }
    const open = await measure(12000)
    const closed = await measure(300)
    expect(closed).toBeLessThan(open * 0.2)
  })

  it("filter.enabled (id 8) = 0 bypasses the filter", async () => {
    const measure = async (enabled: number) => {
      const e = await fresh()
      e.set_param(id("oscA.position"), 0.67)
      e.set_param(id("filter.cutoff"), 200)
      e.set_param(id("filter.enabled"), enabled)
      e.note_on(48, 1)
      render(e, 20)
      return brightness(render(e, 100))
    }
    expect(await measure(0)).toBeGreaterThan((await measure(1)) * 5)
  })

  it("sequencer plays the pattern and reports the step", async () => {
    const e = await fresh()
    expect(e.current_step()).toBe(-1)
    e.pattern_clear(16)
    e.pattern_add(0, 60, 1, 1)
    e.set_transport(1, 120)
    const out = render(e, 40) // ~107 ms: step 0 sounding
    expect(e.current_step()).toBe(0)
    expect(rms(out)).toBeGreaterThan(0.05)
    render(e, 10) // past 6000 samples: step 1
    expect(e.current_step()).toBe(1)
    e.set_transport(0, 120)
    expect(e.current_step()).toBe(-1)
  })
})
