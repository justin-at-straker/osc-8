// The app's single source of truth for M1: patch, pattern and transport.
// Knobs, the piano roll, AI patch tools and UI SDK `act` all write here; the
// engine bridge (src/engine/bridge.ts) subscribes and forwards changes to the worklet.
import { useSyncExternalStore } from "react"
import { defaultPatch, Patch, type PatchEdit } from "@/engine/patch"
import type { Pattern } from "@/engine/protocol"

export type Source = "user" | "ai" | "agent" | "load"

export type State = {
  patch: Patch
  pattern: Pattern
  transport: { playing: boolean; bpm: number }
  /** Playhead from the engine; -1 when stopped. Not part of undo. */
  step: number
  audio: "off" | "starting" | "on" | "error"
}

const initial: State = {
  patch: defaultPatch(),
  pattern: { steps: 16, notes: [] },
  transport: { playing: false, bpm: 120 },
  step: -1,
  audio: "off",
}

let state = initial
const listeners = new Set<() => void>()
const past: Patch[] = []
const future: Patch[] = []

function emit() {
  for (const l of listeners) l()
}

export function getState() {
  return state
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

/** Deep-merge plain objects; arrays and wavetable refs (`table`) are replaced whole. */
function deepMerge(base: unknown, edit: unknown, key?: string): unknown {
  if (key === "table" || !isPlainObject(base) || !isPlainObject(edit)) return edit
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(edit)) if (v !== undefined) out[k] = deepMerge(base[k], v, k)
  return out
}

/** Who made the most recent patch change, for "AI changed X" UI. */
export let lastSource: Source = "load"

// While a batch is open, edits share one undo entry (e.g. a whole AI agent run).
let batchDepth = 0
let batchOpened = false

/** Group every patch edit made inside `fn` into a single undo step. */
export async function batch<T>(fn: () => Promise<T> | T): Promise<T> {
  if (batchDepth++ === 0) batchOpened = false
  try {
    return await fn()
  } finally {
    batchDepth--
  }
}

function pushUndo(prev: Patch) {
  if (batchDepth > 0 && batchOpened) return
  if (batchDepth > 0) batchOpened = true
  past.push(prev)
  if (past.length > 200) past.shift()
  future.length = 0
}

/** Deep-merge a partial edit onto the patch, validate, and record undo. Throws on invalid input. */
export function editPatch(edit: PatchEdit | DeepPartial<Patch>, source: Source = "user"): Patch {
  const next = Patch.parse(deepMerge(state.patch, edit))
  pushUndo(state.patch)
  lastSource = source
  state = { ...state, patch: next }
  emit()
  return next
}

export type DeepPartial<T> = T extends unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

/** Set one field by dotted path, e.g. setPatchValue("filter.cutoff", 800). Used by knobs. */
export function setPatchValue(path: string, value: unknown, source: Source = "user") {
  const [section, ...rest] = path.split(".")
  if (rest.length === 0) return editPatch({ [section]: value } as PatchEdit, source)
  const current = structuredClone((state.patch as Record<string, unknown>)[section]) as Record<string, unknown>
  let node = current
  for (const k of rest.slice(0, -1)) node = node[k] as Record<string, unknown>
  node[rest[rest.length - 1]] = value
  return editPatch({ [section]: current } as PatchEdit, source)
}

export function replacePatch(patch: Patch, source: Source = "load") {
  return editPatch(patch as PatchEdit, source)
}

export function undo() {
  const prev = past.pop()
  if (!prev) return
  future.push(state.patch)
  state = { ...state, patch: prev }
  emit()
}

export function redo() {
  const next = future.pop()
  if (!next) return
  past.push(state.patch)
  state = { ...state, patch: next }
  emit()
}

export function setPattern(pattern: Pattern) {
  state = { ...state, pattern }
  emit()
}

export function setTransport(t: Partial<State["transport"]>) {
  state = { ...state, transport: { ...state.transport, ...t } }
  emit()
}

export function setStep(step: number) {
  if (step === state.step) return
  state = { ...state, step }
  emit()
}

export function setAudio(audio: State["audio"]) {
  state = { ...state, audio }
  emit()
}
