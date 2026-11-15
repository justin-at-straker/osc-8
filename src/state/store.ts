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

/** Merge a section-level partial edit onto the patch, validate, and record undo. Throws on invalid input. */
export function editPatch(edit: PatchEdit, _source: Source = "user"): Patch {
  const merged: Record<string, unknown> = { ...state.patch }
  for (const [key, value] of Object.entries(edit)) {
    const current = (state.patch as Record<string, unknown>)[key]
    merged[key] =
      value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)
        ? { ...current, ...value }
        : value
  }
  const next = Patch.parse(merged)
  past.push(state.patch)
  if (past.length > 200) past.shift()
  future.length = 0
  state = { ...state, patch: next }
  emit()
  return next
}

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
