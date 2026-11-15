// Patterns longer than one bar: resizing (by repeating bars), and the page
// (bar) each track's grid shows, with follow-the-playhead.
import { useSyncExternalStore } from "react"
import { endGesture, getState, setDrumPattern, setPattern } from "@/state/store"
import type { Track } from "./drum-model"

export const BAR_STEPS = 16
export const LENGTH_BARS = [1, 2, 4, 8] as const
export type Bars = (typeof LENGTH_BARS)[number]

export const barsOf = (steps: number) => Math.max(1, Math.ceil(steps / BAR_STEPS))

/**
 * Fit step-placed items to a new length. Longer: the existing pattern repeats
 * to fill it (1 bar -> 4 bars plays bar 1 four times). Shorter: items starting
 * past the new end are dropped; lengths are kept (notes may wrap).
 */
export function resize<T extends { step: number }>(items: T[], from: number, to: number): T[] {
  if (to <= from) return items.filter((item) => item.step < to)
  const out = [...items]
  for (let offset = from; offset < to; offset += from) {
    for (const item of items) if (item.step + offset < to) out.push({ ...item, step: item.step + offset })
  }
  return out.sort((a, b) => a.step - b.step)
}

/** Set the synth pattern to `bars` bars, as one undo step. */
export function setPatternBars(bars: number) {
  const p = getState().pattern
  const steps = bars * BAR_STEPS
  if (steps === p.steps) return
  endGesture()
  setPattern({ ...p, steps, notes: resize(p.notes, p.steps, steps) })
  endGesture()
}

/** Set the 808 pattern to `bars` bars, as one undo step. */
export function setDrumBars(bars: number) {
  const p = getState().drums.pattern
  const steps = bars * BAR_STEPS
  if (steps === p.steps) return
  endGesture()
  setDrumPattern({ ...p, steps, hits: resize(p.hits, p.steps, steps) })
  endGesture()
}

// ---- Which bar each track's grid shows, and whether it follows the playhead. ----

export type Paging = { page: number; follow: boolean }
const paging: Record<Track, Paging> = { synth: { page: 0, follow: true }, "808": { page: 0, follow: true } }
const listeners = new Set<() => void>()
function update(track: Track, next: Partial<Paging>) {
  const cur = paging[track]
  if ((next.page ?? cur.page) === cur.page && (next.follow ?? cur.follow) === cur.follow) return
  paging[track] = { ...cur, ...next }
  for (const l of listeners) l()
}

export function usePaging(track: Track): Paging {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => paging[track]
  )
}

/** Pick a bar by hand: shows it and turns follow off. */
export const showBar = (track: Track, page: number) => update(track, { page, follow: false })
/** Page without touching follow (the follow itself, keyboard paging). */
export const setPage = (track: Track, page: number) => update(track, { page })
export const setFollow = (track: Track, follow: boolean) => update(track, { follow })

/** The playhead's position within a track of `steps` steps, or -1 when stopped. */
export const localStep = (step: number, steps: number) => (step < 0 ? -1 : step % steps)
