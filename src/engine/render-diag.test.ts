// Diagnostic: render a preset offline through the real wasm and log level/spectrum stats.
// Run: PRESET="BS Wub Machine" DIAG_OUT=diag.txt pnpm vitest run src/engine/render-diag.test.ts
import { readFileSync } from "node:fs"
import { it } from "vitest"
import { appendFileSync, writeFileSync } from "node:fs"
const OUT = process.env.DIAG_OUT ?? "diag.txt"
const log = (...a: unknown[]) => appendFileSync(OUT, a.join(" ") + String.fromCharCode(10))
import { patchToParams } from "@/engine/params"
import { FACTORY_PRESETS } from "@/ui/presets"
import type { Patch } from "@/engine/patch"

const SR = 48000
async function engine() {
  const { instance } = await WebAssembly.instantiate(readFileSync("src/engine/osc8.wasm"))
  return instance.exports as any
}
function band(x: Float32Array, lo: number, hi: number) {
  // crude: energy of a one-pole bandpass approximation via two one-poles
  const a1 = Math.exp((-2 * Math.PI * hi) / SR), a2 = Math.exp((-2 * Math.PI * lo) / SR)
  let l1 = 0, l2 = 0, e = 0
  for (const v of x) { l1 = (1 - a1) * v + a1 * l1; l2 = (1 - a2) * v + a2 * l2; const b = l1 - l2; e += b * b }
  return Math.sqrt(e / x.length)
}
async function render(p: Patch, notes: number[], seconds = 2) {
  const e = await engine()
  e.init(SR)
  for (const [id, v] of patchToParams(p)) e.set_param(id, v)
  e.set_transport(1, 118); e.set_transport(0, 118) // tempo for synced LFOs
  for (const n of notes) e.note_on(n, 0.9)
  const blocks = Math.round((seconds * SR) / 128)
  const L = new Float32Array(blocks * 128), R = new Float32Array(blocks * 128)
  for (let b = 0; b < blocks; b++) {
    e.process(128)
    const mem = new Float32Array(e.memory.buffer)
    L.set(mem.subarray(e.out_left() / 4, e.out_left() / 4 + 128), b * 128)
    R.set(mem.subarray(e.out_right() / 4, e.out_right() / 4 + 128), b * 128)
  }
  const m = new Float32Array(L.length); for (let i = 0; i < L.length; i++) m[i] = (L[i] + R[i]) / 2
  let peak = 0, sq = 0, hot = 0
  for (const v of m) { peak = Math.max(peak, Math.abs(v)); sq += v * v; if (Math.abs(v) > 0.9) hot++ }
  const r = (x: number) => x.toFixed(3)
  return `rms ${r(Math.sqrt(sq / m.length))} peak ${r(peak)} >0.9: ${((100 * hot) / m.length).toFixed(1)}% | <30Hz ${r(band(m, 1, 30))} 30-120 ${r(band(m, 30, 120))} 120-1k ${r(band(m, 120, 1000))} 1k-5k ${r(band(m, 1000, 5000))} 5k+ ${r(band(m, 5000, 20000))}`
}

it.skipIf(!process.env.PRESET)("diagnose (set PRESET=name)", async () => {
  writeFileSync(OUT, "")
  const name = process.env.PRESET ?? "BS Wub Machine"
  const p = FACTORY_PRESETS.find((x) => x.name === name)!
  const strip = (q: Patch, o: Partial<Patch>) => ({ ...q, ...o }) as Patch
  log(name)
  log("current, single C3     ", await render(p, [48]))
  log("current, Dm chord      ", await render(p, [62, 65, 69]))
  log("no sub                 ", await render(strip(p, { sub: { ...p.sub, enabled: false } }), [48]))
  log("no sub/oscB            ", await render(strip(p, { sub: { ...p.sub, enabled: false }, oscB: { ...p.oscB, enabled: false } }), [48]))
  log("no sub/oscB/unison     ", await render(strip(p, { sub: { ...p.sub, enabled: false }, oscB: { ...p.oscB, enabled: false }, oscA: { ...p.oscA, unison: 1 } }), [48]))
})
