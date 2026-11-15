// Loading presets and knowing whether the patch has been edited since.
// A patch counts as unmodified while the store holds the very object that was
// loaded (a preset, an import, init). Undo restores earlier objects, so undoing
// back to a loaded patch clears the "*" again.
import type { Patch } from "@/engine/patch"
import { canRedo, getState, lastSource, replacePatch, subscribe, useStore } from "@/state/store"
import { FACTORY_PRESETS, PRESET_CATEGORIES, presetCategory, type PresetCategory } from "./presets"

const pristine = new WeakSet<Patch>([getState().patch])
let seen = getState().patch

// Anything replaced with source "load" (a patch file import, say) is clean too.
// Not on undo/redo: those leave lastSource as it was, but leave redo available.
subscribe(() => {
  const { patch } = getState()
  if (patch === seen) return
  seen = patch
  if (lastSource === "load" && !canRedo()) pristine.add(patch)
})

/** Index into FACTORY_PRESETS of the preset the current patch came from, or -1. */
export function presetIndexOf(patch: Patch): number {
  return FACTORY_PRESETS.findIndex((p) => patch.id === p.id || patch.id.startsWith(`${p.id}:`))
}

/** Load a preset as one undo step, under a fresh id derived from the preset's. */
export function loadPreset(preset: Patch) {
  const id = `${preset.id}:${Math.random().toString(36).slice(2, 10)}`
  const next = replacePatch({ ...structuredClone(preset), id }, "load")
  pristine.add(next)
  return next
}

/** Load the next (+1) or previous (-1) factory preset, wrapping round. */
export function stepPreset(by: 1 | -1) {
  const at = presetIndexOf(getState().patch)
  const n = FACTORY_PRESETS.length
  const next = at < 0 ? (by > 0 ? 0 : n - 1) : (at + by + n) % n
  return loadPreset(FACTORY_PRESETS[next])
}

export const isModified = (patch: Patch) => !pristine.has(patch)

/** The current patch's name and whether it has been edited since it was loaded. */
export function usePatchStatus() {
  const name = useStore((s) => s.patch.name)
  const modified = useStore((s) => isModified(s.patch))
  const index = useStore((s) => presetIndexOf(s.patch))
  return { name, modified, index }
}

/** Factory presets by category, in bank order. */
export const PRESETS_BY_CATEGORY = (Object.keys(PRESET_CATEGORIES) as PresetCategory[])
  .map((category) => ({ category, label: PRESET_CATEGORIES[category], presets: FACTORY_PRESETS.filter((p) => presetCategory(p) === category) }))
  .filter((group) => group.presets.length > 0)

/** Load a factory preset by its id (a menu item's value). Returns false for anything else. */
export function loadPresetById(id: string) {
  const preset = FACTORY_PRESETS.find((p) => p.id === id)
  if (preset) loadPreset(preset)
  return !!preset
}
