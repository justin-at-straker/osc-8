// The mod matrix as the UI sees it: sources, targets, and the edits that
// add, select, tune and delete routes. Everything writes through the store.
import { useSyncExternalStore } from "react"
import { MOD_SOURCES, type Patch } from "@/engine/patch"
import { MOD_TARGETS } from "@/engine/params"
import { editPatch, getState, setPatchValue } from "@/state/store"

export type ModSource = (typeof MOD_SOURCES)[number]
export type ModFamily = "lfo" | "env" | "other"
export type Route = Patch["mod"][number]

export const MAX_ROUTES = 16
export const DEFAULT_AMOUNT = 0.25

export const SOURCE_LABELS: Record<ModSource, string> = {
  none: "None",
  env1: "Amp env",
  env2: "Env 2",
  env3: "Env 3",
  lfo1: "LFO 1",
  lfo2: "LFO 2",
  lfo3: "LFO 3",
  lfo4: "LFO 4",
  velocity: "Velocity",
  modwheel: "Mod wheel",
  note: "Note",
  random: "Random",
}

/** Sources with a drag handle on the panel. */
export const HANDLE_SOURCES = ["lfo1", "lfo2", "lfo3", "lfo4", "env2", "env3"] as const satisfies readonly ModSource[]
/** Sources offered by a knob's "Modulate with" menu. */
export const MENU_SOURCES = [...HANDLE_SOURCES, "velocity", "note", "random"] as const satisfies readonly ModSource[]

export const sourceFamily = (source: ModSource): ModFamily =>
  source.startsWith("lfo") ? "lfo" : source.startsWith("env") ? "env" : "other"

/** Human names for every modulatable parameter, the same words as the knobs' labels. */
export const TARGET_LABELS: Record<string, string> = {
  "oscA.position": "Osc A position",
  "oscA.level": "Osc A level",
  "oscA.semi": "Osc A semitone",
  "oscA.fine": "Osc A fine tune",
  "filter.cutoff": "Filter cutoff",
  "filter.resonance": "Filter resonance",
  "master.volume": "Master volume",
  "fx.distortion.drive": "Distortion drive",
  "fx.distortion.mix": "Distortion mix",
  "fx.chorus.mix": "Chorus mix",
  "fx.delay.mix": "Delay mix",
  "fx.delay.feedback": "Delay feedback",
  "fx.reverb.mix": "Reverb mix",
  "fx.reverb.size": "Reverb size",
  "fx.ott.depth": "OTT depth",
  "fx.eq.low": "EQ low",
  "fx.eq.mid": "EQ mid",
  "fx.eq.high": "EQ high",
}

export const isModTarget = (path: string | null | undefined): path is string => !!path && path in MOD_TARGETS
export const targetLabel = (path: string) => TARGET_LABELS[path] ?? path

// ---- Selection: the route last added or picked, highlighted in the routes list. ----

let selected = -1
const selectionListeners = new Set<() => void>()
export function selectRoute(index: number) {
  if (index === selected) return
  selected = index
  for (const l of selectionListeners) l()
}
export function useSelectedRoute() {
  return useSyncExternalStore(
    (l) => (selectionListeners.add(l), () => selectionListeners.delete(l)),
    () => selected
  )
}

// ---- Edits ----

export type AddResult = { index: number; added: boolean } | { index: -1; added: false; reason: "invalid" | "full" }

/** Route `source` to `target`. An existing source->target route is selected rather than duplicated. */
export function addRoute(source: ModSource, target: string, amount = DEFAULT_AMOUNT): AddResult {
  if (source === "none" || !isModTarget(target)) return { index: -1, added: false, reason: "invalid" }
  const { mod } = getState().patch
  const existing = mod.findIndex((r) => r.source === source && r.target === target)
  if (existing >= 0) {
    selectRoute(existing)
    return { index: existing, added: false }
  }
  if (mod.length >= MAX_ROUTES) return { index: -1, added: false, reason: "full" }
  editPatch({ mod: [...mod, { source, target, amount, aux: "none" }] }, "user")
  selectRoute(mod.length)
  return { index: mod.length, added: true }
}

export function removeRoute(index: number) {
  const { mod } = getState().patch
  if (!mod[index]) return
  editPatch({ mod: mod.filter((_, i) => i !== index) }, "user")
  if (selected === index) selectRoute(-1)
  else if (selected > index) selectRoute(selected - 1)
}

/** Remove every route into one parameter. */
export function clearTarget(target: string) {
  const { mod } = getState().patch
  if (!mod.some((r) => r.target === target)) return
  editPatch({ mod: mod.filter((r) => r.target !== target) }, "user")
  selectRoute(-1)
}

const clampAmount = (a: number) => Math.max(-1, Math.min(1, Math.round(a * 1000) / 1000))

/** Set a route's amount; a drag's run of edits coalesces into one undo step in the store. */
export function setRouteAmount(index: number, amount: number) {
  if (!getState().patch.mod[index]) return
  setPatchValue(`mod.${index}.amount`, clampAmount(amount), "user")
}

export function setRouteAux(index: number, aux: ModSource) {
  if (!getState().patch.mod[index]) return
  setPatchValue(`mod.${index}.aux`, aux, "user")
}

// ---- The ring a routed knob draws ----

/** Normalise a value into a target's mod range (log space for cutoff), 0..1. */
export function toModSpace(target: string, value: number) {
  const r = MOD_TARGETS[target]
  if (!r) return 0
  const n = r.log ? Math.log(value / r.min) / Math.log(r.max / r.min) : (value - r.min) / (r.max - r.min)
  return Math.max(0, Math.min(1, n))
}

export function fromModSpace(target: string, n: number) {
  const r = MOD_TARGETS[target]
  const t = Math.max(0, Math.min(1, n))
  return r.log ? r.min * (r.max / r.min) ** t : r.min + (r.max - r.min) * t
}

/** Summary of the routes into one target: total amount, the newest route and its family. "" when unrouted. */
export function routeSummary(mod: Route[], target: string): string {
  let sum = 0
  let last = -1
  mod.forEach((r, i) => {
    if (r.target === target && r.source !== "none") {
      sum += r.amount
      last = i
    }
  })
  return last < 0 ? "" : `${sum}|${last}|${sourceFamily(mod[last].source)}`
}

export function parseSummary(summary: string) {
  if (!summary) return null
  const [sum, last, family] = summary.split("|")
  return { sum: Number(sum), last: Number(last), family: family as ModFamily }
}

/** "+25%" / "-40%": a route amount as a share of the target's range. */
export const formatAmount = (a: number) => `${a > 0 ? "+" : a < 0 ? "-" : ""}${Math.round(Math.abs(a) * 100)}%`
