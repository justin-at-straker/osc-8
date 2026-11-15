// 808 pattern edits and the UI's selected drum voice. Pattern edits go
// through setDrumPattern (undo; a drag's run of edits shares one entry).
import { useSyncExternalStore } from "react"
import { DEMO_DRUMS, DRUM_LABELS, DRUM_VOICES, type DrumHit, type DrumPattern, type DrumVoice } from "@/engine/drums"
import { getState, setDrumPattern } from "@/state/store"

export const HIT_VELOCITY = 0.8
export type Track = "synth" | "808"

const find = (p: DrumPattern, voice: DrumVoice, step: number) => p.hits.findIndex((h) => h.voice === voice && h.step === step)
const order = (hits: DrumHit[]) =>
  [...hits].sort((a, b) => a.step - b.step || DRUM_VOICES.indexOf(a.voice) - DRUM_VOICES.indexOf(b.voice))

export const hasHit = (p: DrumPattern, voice: DrumVoice, step: number) => find(p, voice, step) >= 0

/** Turn a hit on or off. No-op when it's already that way, so a paint drag doesn't rewrite cells it passes twice. */
export function setHit(voice: DrumVoice, step: number, on: boolean) {
  const p = getState().drums.pattern
  const at = find(p, voice, step)
  if (on === at >= 0) return
  const hits = on ? order([...p.hits, { step, voice, velocity: HIT_VELOCITY, accent: false }]) : p.hits.filter((_, i) => i !== at)
  setDrumPattern({ ...p, hits }, "user")
}

export function toggleHit(voice: DrumVoice, step: number) {
  setHit(voice, step, !hasHit(getState().drums.pattern, voice, step))
}

/** Toggle a hit's accent; an empty cell gets an accented hit. */
export function toggleAccent(voice: DrumVoice, step: number) {
  const p = getState().drums.pattern
  const at = find(p, voice, step)
  const hits =
    at < 0
      ? order([...p.hits, { step, voice, velocity: HIT_VELOCITY, accent: true }])
      : p.hits.map((h, i) => (i === at ? { ...h, accent: !h.accent } : h))
  setDrumPattern({ ...p, hits }, "user")
}

export function clearDrums() {
  const p = getState().drums.pattern
  if (p.hits.length) setDrumPattern({ ...p, hits: [] }, "user")
}

/** Seed the starter beat if the drum pattern is empty. Safe to call any number of times. */
export function seedDrums() {
  if (getState().drums.pattern.hits.length === 0) setDrumPattern(DEMO_DRUMS, "load")
}

// ---- The voice selected for editing (DRUM tab), shared with the grid's row labels. ----

let selected: DrumVoice = "kick"
const listeners = new Set<() => void>()
export function selectVoice(voice: DrumVoice) {
  if (voice === selected) return
  selected = voice
  for (const l of listeners) l()
}
export function useSelectedVoice(): DrumVoice {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => selected
  )
}

/** A drum cell's name everywhere: "Kick, bar 1, step 1", bar and step 1-based. */
export const drumCellLabel = (voice: DrumVoice, step: number) => `${DRUM_LABELS[voice]}, bar ${Math.floor(step / 16) + 1}, step ${(step % 16) + 1}`
