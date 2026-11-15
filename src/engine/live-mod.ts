// Forwards the engine's live modulated values to the knob rings, at most once
// per animation frame, keyed by patch path (the UI's vocabulary).
import { PARAMS } from "./params"
import { getModValues, subscribeModValues } from "./bridge"
import { setLiveModValues } from "@/ui/mod-live"

export function connectLiveMod(): () => void {
  let frame = 0
  const flush = () => {
    frame = 0
    const values = getModValues()
    if (!values) return setLiveModValues({})
    const next: Record<string, number> = {}
    for (const [id, key] of PARAMS) if (id < values.length) next[key] = values[id]
    setLiveModValues(next)
  }
  const off = subscribeModValues(() => {
    if (!frame) frame = requestAnimationFrame(flush)
  })
  return () => {
    off()
    cancelAnimationFrame(frame)
  }
}
