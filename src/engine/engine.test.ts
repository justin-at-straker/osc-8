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

/** Render `blocks` x 128 frames of both channels. */
function renderStereo(e: Exports, blocks: number): [Float32Array, Float32Array] {
  const l = new Float32Array(blocks * 128)
  const r = new Float32Array(blocks * 128)
  for (let b = 0; b < blocks; b++) {
    e.process(128)
    l.set(new Float32Array(e.memory.buffer, e.out_left(), 128), b * 128)
    r.set(new Float32Array(e.memory.buffer, e.out_right(), 128), b * 128)
  }
  return [l, r]
}

/** A short blip: instant attack, ~20 ms long. */
function blipPatch() {
  const p = defaultPatch()
  p.oscA.position = 0.67
  p.env1 = { attack: 0, decay: 0.01, sustain: 0, release: 0.01 }
  return p
}

async function withPatch(p: ReturnType<typeof defaultPatch>): Promise<Exports> {
  const instance = await WebAssembly.instantiate(module, {})
  const e = instance.exports as unknown as Exports
  e.init(SR)
  for (const [i, v] of patchToParams(p)) e.set_param(i, v)
  return e
}

describe("osc8.wasm FX chain (ids 14..38)", () => {
  it("disabled FX (the default patch) is bit-identical to sending no FX params", async () => {
    const a = await fresh()
    const instance = await WebAssembly.instantiate(module, {})
    const b = instance.exports as unknown as Exports
    b.init(SR)
    for (const [i, v] of patchToParams(defaultPatch())) if (i < 14) b.set_param(i, v)
    a.note_on(60, 1)
    b.note_on(60, 1)
    const [al, ar] = renderStereo(a, 100)
    const [bl, br] = renderStereo(b, 100)
    expect(al).toEqual(bl)
    expect(ar).toEqual(br)
  })

  it("every effect alone at full mix is finite and <= 1", async () => {
    const solo: ((p: ReturnType<typeof defaultPatch>) => void)[] = [
      (p) => (p.fx.distortion = { enabled: true, type: "fold", drive: 1, mix: 1 }),
      (p) => (p.fx.chorus = { enabled: true, rate: 10, depth: 1, mix: 1 }),
      (p) => (p.fx.delay = { enabled: true, time: "1/16", feedback: 1, mix: 1, pingPong: true }),
      (p) => (p.fx.reverb = { enabled: true, size: 1, decay: 1, damping: 0, mix: 1 }),
      (p) => (p.fx.ott = { enabled: true, depth: 1, time: 0 }),
      (p) => (p.fx.eq = { enabled: true, low: 12, mid: 12, high: 12 }),
    ]
    for (const edit of solo) {
      const p = defaultPatch()
      edit(p)
      const e = await withPatch(p)
      for (const n of [48, 55, 60, 64, 67]) e.note_on(n, 1)
      const [l, r] = renderStereo(e, 200)
      for (const x of [l, r]) {
        expect(x.every(Number.isFinite)).toBe(true)
        expect(Math.max(...x.map(Math.abs))).toBeLessThanOrEqual(1)
      }
      expect(rms(l)).toBeGreaterThan(0.01)
    }
  })

  it("delay 1/8 at 120 bpm echoes 12000 samples later", async () => {
    const p = blipPatch()
    p.fx.delay = { enabled: true, time: "1/8", feedback: 0, mix: 1, pingPong: false }
    const e = await withPatch(p)
    e.set_transport(0, 120) // tempo reaches the delay even while stopped
    e.note_on(60, 1)
    const [l] = renderStereo(e, 110) // 14080 samples
    expect(rms(l.subarray(2000, 11900))).toBeLessThan(1e-6) // dry is fully replaced at mix 1
    expect(rms(l.subarray(12000, 13000))).toBeGreaterThan(0.05)
  })

  it("ping-pong puts the first echo left and the second right", async () => {
    const p = blipPatch()
    p.fx.delay = { enabled: true, time: "1/8", feedback: 0.6, mix: 1, pingPong: true }
    const e = await withPatch(p)
    e.note_on(60, 1)
    const [l, r] = renderStereo(e, 200) // 25600 samples
    expect(rms(l.subarray(12000, 13000))).toBeGreaterThan(0.02)
    expect(rms(r.subarray(12000, 13000))).toBeLessThan(1e-6)
    expect(rms(r.subarray(24000, 25000))).toBeGreaterThan(0.01)
    expect(rms(l.subarray(24000, 25000))).toBeLessThan(1e-6)
  })

  it("reverb keeps ringing in stereo after the note has stopped", async () => {
    const p = blipPatch()
    p.fx.reverb = { enabled: true, size: 0.7, decay: 0.7, damping: 0.3, mix: 0.5 }
    const e = await withPatch(p)
    e.note_on(60, 1)
    renderStereo(e, 4)
    e.note_off(60)
    const [l, r] = renderStereo(e, 150)
    const tailL = l.subarray(9600)
    const tailR = r.subarray(9600)
    expect(rms(tailL)).toBeGreaterThan(1e-3)
    expect(tailL).not.toEqual(tailR)
  })

  it("distortion makes the sine brighter; eq low +12 dB makes a low note louder", async () => {
    const sine = (edit: (p: ReturnType<typeof defaultPatch>) => void, note = 57) => async () => {
      const p = defaultPatch()
      p.filter.enabled = false
      edit(p)
      const e = await withPatch(p)
      e.note_on(note, 1)
      renderStereo(e, 40)
      return renderStereo(e, 100)[0]
    }
    const dry = await sine(() => {})()
    const driven = await sine((p) => (p.fx.distortion = { enabled: true, type: "hard", drive: 0.8, mix: 1 }))()
    expect(brightness(driven)).toBeGreaterThan(brightness(dry) * 3)
    const low = await sine(() => {}, 33)()
    const boosted = await sine((p) => (p.fx.eq = { enabled: true, low: 12, mid: 0, high: 0 }), 33)()
    expect(rms(boosted)).toBeGreaterThan(rms(low) * 2)
  })
})
