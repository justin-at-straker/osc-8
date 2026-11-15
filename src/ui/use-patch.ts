import { setPatchValue, useStore } from "@/state/store"
import type { Patch } from "@/engine/patch"

/** Read one field of the patch by dotted path. Selects a primitive, so it re-renders only when that field changes. */
export function readPath(patch: Patch, path: string): unknown {
  let node: unknown = patch
  for (const key of path.split(".")) node = (node as Record<string, unknown> | undefined)?.[key]
  return node
}

export function usePatchValue<T>(path: string): T {
  return useStore((s) => readPath(s.patch, path) as T)
}

/** Write a knob's value. The store validates; a value the schema rejects is dropped rather than thrown into React. */
export function writePatchValue(path: string, value: unknown) {
  try {
    setPatchValue(path, value, "user")
  } catch (error) {
    console.warn(`Rejected ${path} = ${String(value)}`, error)
  }
}
