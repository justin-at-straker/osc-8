// Flat parameter IDs: how a patch crosses the JS -> WASM boundary.
// The numeric IDs MUST match engine/src/params.rs exactly. Append only; never renumber.
// Values are sent in the same engineering units as patch.ts.
import type { Patch } from "./patch"
import { BUILTIN_TABLES } from "./patch"

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
] as const

export type ParamKey = (typeof PARAMS)[number][1]

/** Every (id, value) pair for a patch, for a full sync to the engine. */
export function patchToParams(p: Patch): [number, number][] {
  return PARAMS.map(([id, , get]) => [id, get(p)])
}
