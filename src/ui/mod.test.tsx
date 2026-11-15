import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defaultPatch } from "@/engine/patch"
import { editPatch, getState, replacePatch } from "@/state/store"
import { FrontPanel } from "./front-panel"
import { MAX_ROUTES, selectRoute } from "./mod-model"
import { ModPanel } from "./mod-panel"
import { ModSourceStrip } from "./mod-ui"

const realElementFromPoint = document.elementFromPoint

beforeEach(() => {
  act(() => {
    replacePatch(defaultPatch(), "load")
    selectRoute(-1)
  })
})

afterEach(() => {
  document.elementFromPoint = realElementFromPoint
})

const dialOf = (container: HTMLElement, path: string) =>
  container.querySelector<HTMLElement>(`[data-param="${path}"] [data-kit="knob-dial"]`)!

/** Drag a source handle from the strip and release it over `over` (null: over nothing). */
function dragHandle(source: string, over: Element | null) {
  const handle = screen.getAllByLabelText(`${source} source`)[0]
  document.elementFromPoint = () => over
  fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 1, clientY: 1 })
  fireEvent.pointerMove(window, { pointerId: 7, clientX: 50, clientY: 50 })
  act(() => void fireEvent.pointerUp(window, { pointerId: 7, clientX: 50, clientY: 50 }))
}

const setup = () =>
  render(
    <>
      <ModSourceStrip />
      <FrontPanel />
    </>
  )

describe("drag to modulate", () => {
  it("dropping a handle on a mod-target knob adds a route", () => {
    const { container } = setup()
    dragHandle("LFO 1", dialOf(container, "filter.cutoff"))
    expect(getState().patch.mod).toEqual([{ source: "lfo1", target: "filter.cutoff", amount: 0.25, aux: "none" }])
    expect(document.documentElement.dataset.oscModDragging).toBeUndefined()
  })

  it("lights targets while dragging", () => {
    const { container } = setup()
    const dial = dialOf(container, "filter.cutoff")
    document.elementFromPoint = () => dial
    fireEvent.pointerDown(screen.getAllByLabelText("Env 2 source")[0], { button: 0, pointerId: 3 })
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 9, clientY: 9 })
    expect(document.documentElement.dataset.oscModDragging).toBe("env")
    expect(container.querySelector('[data-mod-target="filter.cutoff"]')!.hasAttribute("data-mod-over")).toBe(true)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(document.documentElement.dataset.oscModDragging).toBeUndefined()
    expect(getState().patch.mod).toEqual([])
  })

  it("dropping on a non-target, or on nothing, does nothing", () => {
    const { container } = setup()
    dragHandle("LFO 2", dialOf(container, "env1.attack"))
    dragHandle("LFO 2", null)
    expect(getState().patch.mod).toEqual([])
  })

  it("a duplicate source->target is selected, not added", () => {
    const { container } = setup()
    dragHandle("LFO 1", dialOf(container, "filter.resonance"))
    dragHandle("Env 3", dialOf(container, "master.volume"))
    dragHandle("LFO 1", dialOf(container, "filter.resonance"))
    expect(getState().patch.mod).toHaveLength(2)
    fireEvent.click(screen.getByRole("tab", { name: /Mod/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Routes/ }))
    expect(screen.getByLabelText("Route 1: LFO 1 to Filter resonance").hasAttribute("data-selected")).toBe(true)
    expect(screen.getByLabelText("Route 2: Env 3 to Master volume").hasAttribute("data-selected")).toBe(false)
  })

  it("the knob's context menu adds a route", () => {
    const { container } = setup()
    fireEvent.contextMenu(dialOf(container, "filter.cutoff"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Velocity" }))
    expect(getState().patch.mod).toEqual([{ source: "velocity", target: "filter.cutoff", amount: 0.25, aux: "none" }])
  })

  it("enforces the 16-route maximum", () => {
    const { container } = setup()
    const full = Array.from({ length: MAX_ROUTES }, (_, i) => ({
      source: (["lfo1", "lfo2", "lfo3", "lfo4"] as const)[i % 4],
      target: ["oscA.position", "oscA.level", "filter.resonance", "master.volume"][Math.floor(i / 4)],
      amount: 0.1,
      aux: "none" as const,
    }))
    act(() => void editPatch({ mod: full }))
    dragHandle("Env 2", dialOf(container, "filter.cutoff"))
    fireEvent.contextMenu(dialOf(container, "oscA.fine"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Random" }))
    expect(getState().patch.mod).toHaveLength(MAX_ROUTES)
    expect(getState().patch.mod.some((r) => r.target === "filter.cutoff")).toBe(false)
  })
})

describe("mod rings", () => {
  it("a routed knob draws its ring, and Alt+drag sets the route amount", () => {
    const { container } = setup()
    const area = () => container.querySelector('[data-mod-target="filter.cutoff"]')!
    expect(area().querySelector("[data-osc-mod-ring]")).toBeNull()
    act(() => void editPatch({ mod: [{ source: "lfo1", target: "filter.cutoff", amount: 0.25, aux: "none" }] }))
    const ring = area().querySelector("[data-osc-mod-ring]")!
    expect(ring.getAttribute("data-family")).toBe("lfo")
    expect(ring.querySelector("path")?.getAttribute("d")).toMatch(/^M .* A 46 46/)
    expect(area().querySelector('[data-kit="knob"]')!.getAttribute("data-modulated")).toBe("lfo")

    const dial = dialOf(container, "filter.cutoff")
    fireEvent.pointerDown(dial, { button: 0, altKey: true, pointerId: 2, clientY: 200 })
    fireEvent.pointerMove(dial, { pointerId: 2, clientY: 178 })
    fireEvent.pointerUp(dial, { pointerId: 2 })
    expect(getState().patch.mod[0].amount).toBeCloseTo(0.35, 3)
    // The knob's own value didn't move.
    expect(getState().patch.filter.cutoff).toBe(4000)
  })

  it("the ring follows the target's range (log for cutoff)", () => {
    const { container } = setup()
    // From 632 Hz (half way in log space), +0.5 takes it to the top.
    act(() => void editPatch({ filter: { cutoff: 632 }, mod: [{ source: "env2", target: "filter.cutoff", amount: 0.5, aux: "none" }] }))
    const end = container.querySelector('[data-mod-target="filter.cutoff"] [data-osc-mod-end]')!
    // Travel 1 is the top of the sweep: 135deg clockwise from up.
    expect(Number(end.getAttribute("cx"))).toBeCloseTo(Math.cos((45 * Math.PI) / 180) * 46, 0)
    expect(Number(end.getAttribute("cy"))).toBeCloseTo(Math.sin((45 * Math.PI) / 180) * 46, 0)
  })
})

describe("MOD page", () => {
  it("route amount, aux and delete edit the matrix", () => {
    render(<ModPanel />)
    act(() =>
      void editPatch({
        mod: [
          { source: "lfo1", target: "filter.cutoff", amount: 0.25, aux: "none" },
          { source: "env2", target: "oscA.position", amount: -0.5, aux: "none" },
        ],
      })
    )
    fireEvent.click(screen.getByRole("tab", { name: /Routes/ }))
    fireEvent.keyDown(screen.getByRole("slider", { name: "Route 1 amount" }), { key: "ArrowRight" })
    expect(getState().patch.mod[0].amount).toBeCloseTo(0.26, 5)
    expect(screen.getByRole("slider", { name: "Route 2 amount" }).getAttribute("aria-valuetext")).toBe("-50%")

    fireEvent.click(screen.getByLabelText("Delete route 1"))
    expect(getState().patch.mod).toEqual([{ source: "env2", target: "oscA.position", amount: -0.5, aux: "none" }])
    fireEvent.click(screen.getByLabelText("Delete route 1"))
    expect(getState().patch.mod).toEqual([])
    expect(screen.getByText("Drag an LFO or ENV handle onto any knob")).toBeTruthy()
  })

  it("sync swaps the rate knob for the division selector", () => {
    render(<ModPanel />)
    expect(screen.getByLabelText("LFO 1 division")).toBeTruthy()
    expect(screen.queryByLabelText("LFO 1 rate")).toBeNull()
    fireEvent.click(screen.getByLabelText("LFO 1 sync"))
    expect(getState().patch.lfos[0].sync).toBe(false)
    expect(screen.getByLabelText("LFO 1 rate")).toBeTruthy()
    expect(screen.queryByLabelText("LFO 1 division")).toBeNull()
    fireEvent.keyDown(screen.getByLabelText("LFO 1 rate"), { key: "End" })
    expect(getState().patch.lfos[0].rate).toBe(50)
  })

  it("LFO shape, one-shot and env knobs write the patch", () => {
    render(<ModPanel />)
    fireEvent.click(screen.getAllByRole("radio", { name: "square" })[1])
    expect(getState().patch.lfos[1].shape).toBe("square")
    fireEvent.click(screen.getByLabelText("LFO 3 one-shot"))
    expect(getState().patch.lfos[2].oneShot).toBe(true)
    fireEvent.click(screen.getByRole("tab", { name: "Env" }))
    fireEvent.keyDown(screen.getByLabelText("Env 2 attack"), { key: "End" })
    expect(getState().patch.env2.attack).toBe(20)
    fireEvent.keyDown(screen.getByLabelText("Env 3 sustain"), { key: "Home" })
    expect(getState().patch.env3.sustain).toBe(0)
  })
})
