// Flat parameter IDs: how a patch crosses the JS -> WASM boundary.
// The numeric IDs MUST match engine/src/params.rs exactly. Append only; never renumber.
// Values are sent in the same engineering units as patch.ts.
import type { Patch } from "./patch"
import { BUILTIN_TABLES, DELAY_TIMES, DIST_TYPES } from "./patch"

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

/** Every (id, value) pair for a patch, for a full sync to the engine. */
export function patchToParams(p: Patch): [number, number][] {
  return PARAMS.map(([id, , get]) => [id, get(p)])
}
