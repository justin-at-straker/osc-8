// Flat parameter IDs: how a patch crosses the JS -> WASM boundary.
// The numeric IDs MUST match engine/src/params.rs exactly. Append only; never renumber.
// Values are sent in the same engineering units as patch.ts.
import type { Patch } from "./patch"
import { BUILTIN_TABLES, DELAY_TIMES, DIST_TYPES, LFO_SHAPES, Lfo, MOD_SOURCES } from "./patch"

export const PARAMS = [
  // id, key, getter. M1 wires these; later milestones append.
  [0, "oscA.table", (p: Patch) => (p.oscA.table.kind === "builtin" ? Math.max(0, BUILTIN_TABLES.indexOf(p.oscA.table.name as never)) : 0)],
  [1, "oscA.position", (p: Patch) => p.oscA.position],
  [2, "oscA.level", (p: Patch) => (p.oscA.enabled ? p.oscA.level : 0)],
  [3, "oscA.octave", (p: Patch) => p.oscA.octave],
  [4, "oscA.semi", (p: Patch) => p.oscA.semi],
  [5, "oscA.fine", (p: Patch) => p.oscA.fine],
  [6, "filter.cutoff", (p: Patch) => p.filter.cutoff],
  [7, "filter.resonance", (p: Patch) => p.filter.resonance],
  [8, "filter.enabled", (p: Patch) => (p.filter.enabled ? 1 : 0)],
  [9, "env1.attack", (p: Patch) => p.env1.attack],
  [10, "env1.decay", (p: Patch) => p.env1.decay],
  [11, "env1.sustain", (p: Patch) => p.env1.sustain],
  [12, "env1.release", (p: Patch) => p.env1.release],
  [13, "master.volume", (p: Patch) => p.master.volume],
  // FX chain, in signal order: distortion -> chorus -> delay -> reverb -> ott -> eq.
  // Enums are sent as their index in the patch.ts enum; booleans as 0/1.
  [14, "fx.distortion.enabled", (p: Patch) => (p.fx.distortion.enabled ? 1 : 0)],
  [15, "fx.distortion.type", (p: Patch) => DIST_TYPES.indexOf(p.fx.distortion.type)],
  [16, "fx.distortion.drive", (p: Patch) => p.fx.distortion.drive],
  [17, "fx.distortion.mix", (p: Patch) => p.fx.distortion.mix],
  [18, "fx.chorus.enabled", (p: Patch) => (p.fx.chorus.enabled ? 1 : 0)],
  [19, "fx.chorus.rate", (p: Patch) => p.fx.chorus.rate],
  [20, "fx.chorus.depth", (p: Patch) => p.fx.chorus.depth],
  [21, "fx.chorus.mix", (p: Patch) => p.fx.chorus.mix],
  [22, "fx.delay.enabled", (p: Patch) => (p.fx.delay.enabled ? 1 : 0)],
  [23, "fx.delay.time", (p: Patch) => DELAY_TIMES.indexOf(p.fx.delay.time)],
  [24, "fx.delay.feedback", (p: Patch) => p.fx.delay.feedback],
  [25, "fx.delay.mix", (p: Patch) => p.fx.delay.mix],
  [26, "fx.delay.pingPong", (p: Patch) => (p.fx.delay.pingPong ? 1 : 0)],
  [27, "fx.reverb.enabled", (p: Patch) => (p.fx.reverb.enabled ? 1 : 0)],
  [28, "fx.reverb.size", (p: Patch) => p.fx.reverb.size],
  [29, "fx.reverb.decay", (p: Patch) => p.fx.reverb.decay],
  [30, "fx.reverb.damping", (p: Patch) => p.fx.reverb.damping],
  [31, "fx.reverb.mix", (p: Patch) => p.fx.reverb.mix],
  [32, "fx.ott.enabled", (p: Patch) => (p.fx.ott.enabled ? 1 : 0)],
  [33, "fx.ott.depth", (p: Patch) => p.fx.ott.depth],
  [34, "fx.ott.time", (p: Patch) => p.fx.ott.time],
  [35, "fx.eq.enabled", (p: Patch) => (p.fx.eq.enabled ? 1 : 0)],
  [36, "fx.eq.low", (p: Patch) => p.fx.eq.low], // dB, -12..12
  [37, "fx.eq.mid", (p: Patch) => p.fx.eq.mid],
  [38, "fx.eq.high", (p: Patch) => p.fx.eq.high],
] as const

export type ParamKey = (typeof PARAMS)[number][1]

// ---- Modulation (IDs 39..130) ----
// Generated rather than listed: 4 LFOs, env2/env3, and 16 mod-matrix slots.

const LFO_DIVISIONS = Lfo.shape.syncDivision.options
export const LFO_BASE = 39 // + lfo*5: shape, rate, sync, division, oneShot
export const ENV_BASE = 59 // env2: 59..62, env3: 63..66 (attack, decay, sustain, release)
export const MOD_BASE = 67 // + slot*4: source, target, amount, aux
export const MOD_SLOTS = 16

type Getter = (p: Patch) => number
const MOD_PARAMS: [number, string, Getter][] = []
for (let i = 0; i < 4; i++) {
  const b = LFO_BASE + i * 5
  MOD_PARAMS.push(
    [b, `lfos.${i}.shape`, (p) => LFO_SHAPES.indexOf(p.lfos[i].shape)],
    [b + 1, `lfos.${i}.rate`, (p) => p.lfos[i].rate],
    [b + 2, `lfos.${i}.sync`, (p) => (p.lfos[i].sync ? 1 : 0)],
    [b + 3, `lfos.${i}.syncDivision`, (p) => LFO_DIVISIONS.indexOf(p.lfos[i].syncDivision)],
    [b + 4, `lfos.${i}.oneShot`, (p) => (p.lfos[i].oneShot ? 1 : 0)]
  )
}
for (const [j, env] of (["env2", "env3"] as const).entries()) {
  const b = ENV_BASE + j * 4
  MOD_PARAMS.push(
    [b, `${env}.attack`, (p) => p[env].attack],
    [b + 1, `${env}.decay`, (p) => p[env].decay],
    [b + 2, `${env}.sustain`, (p) => p[env].sustain],
    [b + 3, `${env}.release`, (p) => p[env].release]
  )
}

/**
 * Parameters a mod route may target, with the range the route's `amount`
 * spans: amount 1 sweeps the full range up from the knob's value, -1 the full
 * range down (Serum semantics). "log" ranges modulate in log space (cutoff).
 * The engine clamps the sum to [min, max].
 */
export const MOD_TARGETS: Record<string, { min: number; max: number; log?: boolean }> = {
  "oscA.position": { min: 0, max: 1 },
  "oscA.level": { min: 0, max: 1 },
  "oscA.semi": { min: -24, max: 24 }, // pitch modulation in semitones (vibrato, risers)
  "oscA.fine": { min: -100, max: 100 },
  "filter.cutoff": { min: 20, max: 20000, log: true },
  "filter.resonance": { min: 0, max: 1 },
  "master.volume": { min: 0, max: 1 },
  "fx.distortion.drive": { min: 0, max: 1 },
  "fx.distortion.mix": { min: 0, max: 1 },
  "fx.chorus.mix": { min: 0, max: 1 },
  "fx.delay.mix": { min: 0, max: 1 },
  "fx.delay.feedback": { min: 0, max: 1 },
  "fx.reverb.mix": { min: 0, max: 1 },
  "fx.reverb.size": { min: 0, max: 1 },
  "fx.ott.depth": { min: 0, max: 1 },
  "fx.eq.low": { min: -12, max: 12 },
  "fx.eq.mid": { min: -12, max: 12 },
  "fx.eq.high": { min: -12, max: 12 },
}

/** Param ID for a key, e.g. "filter.cutoff" -> 6. -1 if unknown. */
export function paramId(key: string): number {
  return PARAMS.find(([, k]) => k === key)?.[0] ?? -1
}

for (let s = 0; s < MOD_SLOTS; s++) {
  const b = MOD_BASE + s * 4
  const route = (p: Patch) => p.mod[s]
  // An empty slot or unknown target sends source 0 ("none") / target -1, which the engine ignores.
  MOD_PARAMS.push(
    [b, `mod.${s}.source`, (p) => (route(p) && MOD_TARGETS[route(p).target] ? MOD_SOURCES.indexOf(route(p).source) : 0)],
    [b + 1, `mod.${s}.target`, (p) => (route(p) ? paramId(route(p).target) : -1)],
    [b + 2, `mod.${s}.amount`, (p) => route(p)?.amount ?? 0],
    [b + 3, `mod.${s}.aux`, (p) => (route(p) ? MOD_SOURCES.indexOf(route(p).aux) : 0)]
  )
}

/** Every (id, value) pair for a patch, for a full sync to the engine. */
export function patchToParams(p: Patch): [number, number][] {
  return [...PARAMS.map(([id, , get]): [number, number] => [id, get(p)]), ...MOD_PARAMS.map(([id, , get]): [number, number] => [id, get(p)])]
}

/** Keys of every param the engine renders, including modulation. */
export const ALL_PARAM_KEYS: readonly string[] = [...PARAMS.map(([, k]) => k), ...MOD_PARAMS.map(([, k]) => k)]
