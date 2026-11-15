// Drag-to-modulate with pointer events: press a source handle, drag onto any
// knob whose path is a mod target, release to add the route. While dragging,
// the root carries data-osc-mod-dragging (so CSS can light every valid
// target), the knob under the pointer carries data-mod-over, and resting on
// a tab key for SPRING_MS opens that page, like a spring-loaded folder.
import type * as React from "react"
import { useSyncExternalStore } from "react"
import { addRoute, isModTarget, sourceFamily, type AddResult, type ModSource } from "./mod-model"

export const SPRING_MS = 400

export type ModDrag = { source: ModSource; x: number; y: number; over: string | null } | null

let drag: ModDrag = null
const listeners = new Set<() => void>()
function set(next: ModDrag) {
  drag = next
  for (const l of listeners) l()
}

export function useModDrag(): ModDrag {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => drag
  )
}

/** The mod target element under a point, if any. */
function targetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const target = el?.closest<HTMLElement>("[data-mod-target]") ?? null
  return target && isModTarget(target.dataset.modTarget) ? target : null
}

const tabAt = (x: number, y: number) =>
  (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[role="tab"]') ?? null

/** Start dragging a modulation source from its handle. Resolves with the drop's result (null when dropped elsewhere or cancelled). */
export function beginModDrag(source: ModSource, event: React.PointerEvent<HTMLElement>): Promise<AddResult | null> {
  if (event.button !== 0) return Promise.resolve(null)
  event.preventDefault()
  event.currentTarget.setPointerCapture?.(event.pointerId)
  const root = document.documentElement
  root.dataset.oscModDragging = sourceFamily(source)
  const pointerId = event.pointerId
  let over: HTMLElement | null = null
  let tab: HTMLElement | null = null
  let spring = 0

  set({ source, x: event.clientX, y: event.clientY, over: null })

  return new Promise((resolve) => {
    const point = (e: PointerEvent) => {
      const next = targetAt(e.clientX, e.clientY)
      if (next !== over) {
        over?.removeAttribute("data-mod-over")
        next?.setAttribute("data-mod-over", "")
        over = next
      }
      const nextTab = tabAt(e.clientX, e.clientY)
      if (nextTab !== tab) {
        clearTimeout(spring)
        tab = nextTab
        if (tab && tab.getAttribute("aria-selected") !== "true") {
          const hovered = tab
          spring = window.setTimeout(() => hovered.click(), SPRING_MS)
        }
      }
      set({ source, x: e.clientX, y: e.clientY, over: over?.dataset.modTarget ?? null })
    }
    const finish = (result: AddResult | null) => {
      clearTimeout(spring)
      over?.removeAttribute("data-mod-over")
      delete root.dataset.oscModDragging
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
      window.removeEventListener("keydown", onKey, true)
      set(null)
      resolve(result)
    }
    const onMove = (e: PointerEvent) => e.pointerId === pointerId && point(e)
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      point(e)
      const target = over?.dataset.modTarget
      finish(target ? addRoute(source, target) : null)
    }
    const onCancel = (e: PointerEvent) => e.pointerId === pointerId && finish(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      finish(null)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    window.addEventListener("keydown", onKey, true)
  })
}
