/// <reference types="node" />
// Drives the checked-in osc8.wasm through its raw ABI, the same way the worklet does.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { defaultPatch } from "./patch"
import { PARAMS, paramId, patchToParams } from "./params"
import { DEMO_DRUMS, DRUM_BUS, DRUM_VOICES, defaultKit, kitToParams } from "./drums"
import { DRUM_ORDER } from "./drum-order"

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
  drum_pattern_clear(steps: number): void
  drum_pattern_add(step: number, voice: number, velocity: number, accent: number): void
  drum_trigger(voice: number, velocity: number): void
  set_modwheel(value: number): void
  mod_active(): number
  mod_values_ptr(): number
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

  it("reports the absolute tick, not the synth-wrapped step, so tracks of different lengths each wrap it", async () => {
    const e = await fresh()
    e.pattern_clear(4) // a short synth pattern
    e.drum_pattern_clear(16)
    e.set_transport(1, 120) // 6000 samples per step at 48 kHz
    render(e, 6 * 47) // ~6 steps of 128-frame blocks
    expect(e.current_step()).toBeGreaterThanOrEqual(5) // past the 4-step synth loop
    e.set_transport(0, 120)
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
  p.oscA.randomPhase = 0 // deterministic start (a 20 ms blip is phase-sensitive)
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
    expect(rms(l.subarray(12000, 13000))).toBeGreaterThan(0.02)
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

describe("osc8.wasm modulation (ids 39..130)", () => {
  const modValues = (e: Exports) => new Float32Array(e.memory.buffer, e.mod_values_ptr(), 167)

  it("the default patch has no live routes and reads back knob values", async () => {
    const e = await withPatch(defaultPatch())
    renderStereo(e, 4)
    expect(e.mod_active()).toBe(0)
    const v = modValues(e)
    expect(v[paramId("filter.cutoff")]).toBe(4000)
    expect(v[paramId("master.volume")]).toBeCloseTo(0.7, 6)
  })

  it("a synced LFO on cutoff (via patchToParams) moves the readback at 1/4 = 0.5 s", async () => {
    const p = defaultPatch()
    p.lfos[1] = { shape: "sine", rate: 1, sync: true, syncDivision: "1/4", oneShot: false }
    p.mod = [{ source: "lfo2", target: "filter.cutoff", amount: 0.2, aux: "none" }]
    const e = await withPatch(p)
    e.set_transport(0, 120)
    expect(e.mod_active()).toBe(1)
    e.note_on(48, 1)
    const id = paramId("filter.cutoff")
    const trace: number[] = []
    for (let b = 0; b < 750; b++) {
      e.process(128)
      trace.push(modValues(e)[id]) // 2 s at 128-frame resolution
    }
    const peaks = trace.flatMap((v, i) => (i > 0 && i < trace.length - 1 && v > trace[i - 1] && v >= trace[i + 1] ? [i] : []))
    expect(peaks.length).toBeGreaterThanOrEqual(3)
    for (let k = 1; k < peaks.length; k++) expect(((peaks[k] - peaks[k - 1]) * 128) / SR).toBeCloseTo(0.5, 1)
    // log-space range: base 4000 * 1000^(+-0.2)
    expect(Math.max(...trace)).toBeCloseTo(4000 * 1000 ** 0.2, -2)
    expect(Math.min(...trace)).toBeCloseTo(4000 * 1000 ** -0.2, -1)
  })

  it("modwheel is a source; LFO -> fx.reverb.mix modulates a global target", async () => {
    const p = defaultPatch()
    p.lfos[0] = { shape: "triangle", rate: 4, sync: false, syncDivision: "1/4", oneShot: false }
    p.mod = [
      { source: "modwheel", target: "oscA.position", amount: 0.5, aux: "none" },
      { source: "lfo1", target: "fx.reverb.mix", amount: 0.3, aux: "none" },
    ]
    const e = await withPatch(p)
    e.note_on(60, 1)
    renderStereo(e, 4)
    expect(modValues(e)[paramId("oscA.position")]).toBe(0)
    e.set_modwheel(1)
    renderStereo(e, 4)
    expect(modValues(e)[paramId("oscA.position")]).toBeCloseTo(0.5, 5)
    const mix: number[] = []
    for (let b = 0; b < 100; b++) {
      e.process(128)
      mix.push(modValues(e)[paramId("fx.reverb.mix")])
    }
    expect(Math.max(...mix) - Math.min(...mix)).toBeGreaterThan(0.4)
  })

  it("master volume is applied after the FX: the reverb tail stops at volume 0", async () => {
    const p = blipPatch()
    p.fx.reverb = { enabled: true, size: 0.8, decay: 0.9, damping: 0.3, mix: 0.5 }
    const e = await withPatch(p)
    e.note_on(60, 1)
    renderStereo(e, 4)
    e.note_off(60)
    renderStereo(e, 60)
    expect(rms(renderStereo(e, 20)[0])).toBeGreaterThan(1e-3)
    e.set_param(paramId("master.volume"), 0)
    renderStereo(e, 40)
    expect(rms(renderStereo(e, 20)[0])).toBe(0)
  })
})

describe("osc8.wasm sound sources (ids 131..163)", () => {
  const corr = (a: Float32Array, b: Float32Array) => {
    let ab = 0, aa = 0, bb = 0
    for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i] }
    return ab / Math.sqrt(aa * bb)
  }
  const pitch = (x: Float32Array) => {
    const ups: number[] = []
    for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) ups.push(i - 1 + x[i - 1] / (x[i - 1] - x[i]))
    return ((ups.length - 1) / (ups[ups.length - 1] - ups[0])) * SR
  }

  it("the default patch (unison 1) is mono", async () => {
    const e = await withPatch(defaultPatch())
    e.note_on(57, 1)
    const [l, r] = renderStereo(e, 50)
    expect(l).toEqual(r)
    expect(rms(l)).toBeGreaterThan(0.05)
  })

  it("a wide unison stack on both oscs is stereo, finite and <= 1", async () => {
    const p = defaultPatch()
    p.oscA = { ...p.oscA, unison: 16, detune: 0.4, spread: 1, blend: 1 }
    p.oscB = { ...p.oscB, enabled: true, unison: 16, detune: 0.3, spread: 1, semi: 7 }
    p.sub.enabled = true
    p.noise.enabled = true
    const e = await withPatch(p)
    for (const n of [48, 55, 60, 64]) e.note_on(n, 1)
    renderStereo(e, 40)
    const [l, r] = renderStereo(e, 300)
    for (const x of [l, r]) {
      expect(x.every(Number.isFinite)).toBe(true)
      expect(Math.max(...x.map(Math.abs))).toBeLessThanOrEqual(1)
    }
    expect(corr(l, r)).toBeLessThan(0.7)
  })

  it("oscA.enabled (131) gates osc A; the sub plays an octave below", async () => {
    const p = defaultPatch()
    p.oscA.enabled = false
    let e = await withPatch(p)
    e.note_on(69, 1)
    renderStereo(e, 10)
    expect(rms(renderStereo(e, 40)[0])).toBe(0)
    p.sub = { enabled: true, level: 1, octave: -1, shape: "sine" }
    p.filter.enabled = false
    e = await withPatch(p)
    e.note_on(69, 1)
    renderStereo(e, 40)
    expect(pitch(renderStereo(e, 375)[0])).toBeCloseTo(220, 0)
  })
})

describe("osc8.wasm 808 drum track (ids 1000+)", () => {
  const kitEngine = async () => {
    const e = await withPatch(defaultPatch())
    for (const [i, v] of kitToParams(defaultKit())) e.set_param(i, v)
    return e
  }
  const voice = (v: (typeof DRUM_VOICES)[number]) => DRUM_VOICES.indexOf(v)

  it("the worklet's voice order matches drums.ts", () => {
    expect([...DRUM_ORDER]).toEqual([...DRUM_VOICES])
  })

  it("every voice auditions (drum_trigger) finite and <= 1", async () => {
    for (let v = 0; v < DRUM_VOICES.length; v++) {
      const e = await kitEngine()
      e.drum_trigger(v, 1)
      const [l, r] = renderStereo(e, 40)
      expect(rms(l), DRUM_VOICES[v]).toBeGreaterThan(0.005)
      for (const x of [l, r]) expect(x.every((s) => Number.isFinite(s) && Math.abs(s) <= 1)).toBe(true)
    }
  })

  it("the demo pattern plays with the transport; mute (kit param) silences a voice", async () => {
    const e = await kitEngine()
    e.drum_pattern_clear(DEMO_DRUMS.steps)
    for (const h of DEMO_DRUMS.hits) e.drum_pattern_add(h.step, voice(h.voice), h.velocity, h.accent ? 1 : 0)
    e.set_transport(1, 120)
    expect(rms(renderStereo(e, 375)[0])).toBeGreaterThan(0.02)

    const m = await kitEngine()
    m.set_param(1000 + voice("kick") * 8 + 6, 1)
    m.drum_trigger(voice("kick"), 1)
    expect(rms(renderStereo(m, 40)[0])).toBe(0)
  })

  it("bus level 0 silences drums but not the synth", async () => {
    const e = await kitEngine()
    e.set_param(DRUM_BUS.level, 0)
    renderStereo(e, 10)
    e.drum_trigger(voice("snare"), 1)
    expect(rms(renderStereo(e, 40)[0])).toBe(0)
    e.note_on(60, 1)
    expect(rms(renderStereo(e, 40)[0])).toBeGreaterThan(0.01)
  })
})
