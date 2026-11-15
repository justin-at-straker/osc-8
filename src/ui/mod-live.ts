// Live modulated values from the engine, for the moving dot on routed knobs.
// The engine bridge calls setLiveModValues({ "filter.cutoff": 1830, ... }) as
// its onMod reports arrive (throttled to the frame rate); knobs subscribe per path.
import { useSyncExternalStore } from "react"

let values: Readonly<Record<string, number>> = {}
const listeners = new Set<() => void>()

export function setLiveModValues(next: Record<string, number>) {
  values = next
  for (const l of listeners) l()
}

export function useLiveModValue(path: string): number | undefined {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => values[path]
  )
}
