import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEMO_DRUMS, defaultKit } from "@/engine/drums"
import { defaultPatch } from "@/engine/patch"
import { editKit, getState, replacePatch, setDrumPattern, setKitValue, setPattern, setStep, undo } from "@/state/store"
import { DrumGrid } from "./drum-grid"
import { seedDrums, selectVoice } from "./drum-model"
import { DrumPanel } from "./drum-panel"
import { OscPage } from "./osc-page"
import type { EngineControls } from "./types"

const realElementFromPoint = document.elementFromPoint
const engine = () => ({
  start: vi.fn(() => Promise.resolve()),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  triggerDrum: vi.fn((_voice: number, _velocity: number) => {}),
}) satisfies EngineControls

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  act(() => {
    replacePatch(defaultPatch(), "load")
    setDrumPattern({ steps: 16, hits: [] }, "load")
    editKit(defaultKit(), "load")
    selectVoice("kick")
  })
})

afterEach(() => {
  document.elementFromPoint = realElementFromPoint
  vi.useRealTimers()
})

/** Move the store's gesture clock past its coalescing window, so the next edit is a new undo step. */
const nextGesture = () => vi.setSystemTime(Date.now() + 2000)
const hits = () => getState().drums.pattern.hits.map((h) => `${h.voice}@${h.step}${h.accent ? "!" : ""}`)
const cell = (name: string) => screen.getByRole("gridcell", { name: new RegExp(`^${name}(,|$)`) })

describe("808 grid", () => {
  it("click toggles a hit at velocity 0.8", () => {
    render(<DrumGrid seed={false} />)
    fireEvent.click(cell("Kick, step 1"))
    expect(getState().drums.pattern.hits).toEqual([{ step: 0, voice: "kick", velocity: 0.8, accent: false }])
    expect(cell("Kick, step 1").getAttribute("aria-selected")).toBe("true")
    nextGesture()
    fireEvent.click(cell("Kick, step 1"))
    expect(hits()).toEqual([])
  })

  it("drag paints along the row as one undo step", () => {
    render(<DrumGrid seed={false} />)
    const start = cell("Closed hat, step 1")
    fireEvent.pointerDown(start, { button: 0, pointerId: 1 })
    for (const s of [2, 3, 4]) {
      document.elementFromPoint = () => cell(`Closed hat, step ${s}`)
      fireEvent.pointerMove(start, { pointerId: 1 })
    }
    // Over another row: ignored.
    document.elementFromPoint = () => cell("Kick, step 5")
    fireEvent.pointerMove(start, { pointerId: 1 })
    fireEvent.pointerUp(start, { pointerId: 1 })
    expect(hits()).toEqual(["closedHat@0", "closedHat@1", "closedHat@2", "closedHat@3"])
    act(() => undo())
    expect(hits()).toEqual([])
  })

  it("a drag that starts on a hit erases", () => {
    const evenHats = [0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({ step, voice: "closedHat" as const, velocity: 0.6, accent: false }))
    act(() => setDrumPattern({ steps: 16, hits: evenHats }, "load"))
    render(<DrumGrid seed={false} />)
    const start = cell("Closed hat, step 1")
    fireEvent.pointerDown(start, { button: 0, pointerId: 1 })
    document.elementFromPoint = () => cell("Closed hat, step 3")
    fireEvent.pointerMove(start, { pointerId: 1 })
    fireEvent.pointerUp(start, { pointerId: 1 })
    expect(hits().filter((h) => h.startsWith("closedHat"))).toEqual(["closedHat@4", "closedHat@6", "closedHat@8", "closedHat@10", "closedHat@12", "closedHat@14"])
  })

  it("Shift+click, right-click and Shift+Enter toggle accent", () => {
    render(<DrumGrid seed={false} />)
    fireEvent.pointerDown(cell("Snare, step 5"), { button: 0, shiftKey: true, pointerId: 2 })
    expect(hits()).toEqual(["snare@4!"])
    expect(cell("Snare, step 5, accent").hasAttribute("data-accent")).toBe(true)
    nextGesture()
    fireEvent.contextMenu(cell("Snare, step 5"))
    expect(hits()).toEqual(["snare@4"])
    nextGesture()
    fireEvent.keyDown(cell("Snare, step 5"), { key: "Enter", shiftKey: true })
    expect(hits()).toEqual(["snare@4!"])
  })

  it("a row label plays its voice and selects it", () => {
    const e = engine()
    render(<DrumGrid engine={e} seed={false} />)
    fireEvent.click(screen.getByRole("rowheader", { name: "Closed hat" }))
    expect(e.triggerDrum).toHaveBeenCalledWith(4, 0.8)
    fireEvent.click(screen.getByRole("rowheader", { name: "Kick" }))
    expect(e.triggerDrum).toHaveBeenLastCalledWith(0, 0.8)
    expect(screen.getByRole("rowheader", { name: "Kick" }).closest("[role=row]")!.hasAttribute("data-selected")).toBe(true)
  })

  it("muted rows dim", () => {
    render(<DrumGrid seed={false} />)
    act(() => void setKitValue("voices.cowbell.mute", true))
    expect(screen.getByRole("rowheader", { name: "Cowbell" }).closest("[role=row]")!.hasAttribute("data-muted")).toBe(true)
  })

  it("the playhead follows store step", () => {
    const { container } = render(<DrumGrid seed={false} />)
    expect(container.querySelectorAll("[data-drum-cell][data-now]")).toHaveLength(0)
    act(() => setStep(5))
    const now = [...container.querySelectorAll<HTMLElement>("[data-drum-cell][data-now]")]
    expect(now).toHaveLength(11)
    expect(now.every((el) => el.dataset.drumCell!.endsWith(":5"))).toBe(true)
    act(() => setStep(-1))
  })

  it("seeding is idempotent and has no undo step", () => {
    render(<DrumGrid />)
    expect(getState().drums.pattern).toEqual(DEMO_DRUMS)
    seedDrums()
    seedDrums()
    expect(getState().drums.pattern).toEqual(DEMO_DRUMS)
    const mine = { steps: 16, hits: [{ step: 3, voice: "rim" as const, velocity: 0.8, accent: false }] }
    act(() => setDrumPattern(mine, "load"))
    act(() => seedDrums())
    expect(getState().drums.pattern).toEqual(mine)
  })
})

describe("DRUM tab", () => {
  it("knobs write the kit and follow store changes", () => {
    render(<DrumPanel />)
    fireEvent.keyDown(screen.getByLabelText("Kick tune"), { key: "End" })
    expect(getState().drums.kit.voices.kick.tune).toBe(1)
    fireEvent.keyDown(screen.getByLabelText("Drum swing"), { key: "End" })
    expect(getState().drums.kit.swing).toBe(1)
    fireEvent.keyDown(screen.getByLabelText("Drum bus drive"), { key: "Home" })
    expect(getState().drums.kit.drive).toBe(0)
    fireEvent.click(screen.getByLabelText("Kick mute"))
    expect(getState().drums.kit.voices.kick.mute).toBe(true)

    act(() => void setKitValue("voices.closedHat.decay", 0.25, "ai"))
    expect((screen.getByLabelText("Closed hat decay") as HTMLInputElement).value).toBe("25%")
    act(() => void setKitValue("accent", 0.9, "ai"))
    expect((screen.getByLabelText("Drum accent") as HTMLInputElement).value).toBe("90%")
  })

  it("snappy exists only for the snare", () => {
    const { container } = render(<DrumPanel />)
    expect(screen.queryByLabelText("Kick snappy")).toBeNull()
    expect(screen.queryByLabelText("Clap snappy")).toBeNull()
    fireEvent.click(screen.getByRole("tab", { name: "Snare" }))
    fireEvent.keyDown(screen.getByLabelText("Snare snappy"), { key: "End" })
    expect(getState().drums.kit.voices.snare.snappy).toBe(1)
    expect(container.querySelectorAll("[data-param$='.snappy']")).toHaveLength(1)
  })

  it("the voice keys and grid row labels share one selection", () => {
    const e = engine()
    render(
      <>
        <DrumPanel />
        <DrumGrid engine={e} seed={false} />
      </>
    )
    fireEvent.click(screen.getByRole("rowheader", { name: "Cowbell" }))
    expect(screen.getByRole("tab", { name: "Cowbell" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("region", { name: "Cowbell" })).toBeTruthy()
  })
})

describe("track switch", () => {
  it("swaps roll and grid, follows with the front panel, and keeps the roll's notes", () => {
    const notes = [{ step: 2, note: 60, length: 1, velocity: 0.8 }]
    act(() => setPattern({ steps: 16, notes }, "load"))
    render(<OscPage engine={engine()} audioGate={false} />)
    expect(screen.getByRole("grid", { name: "Piano roll" })).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: "808 drum track" }))
    expect(screen.queryByRole("grid", { name: "Piano roll" })).toBeNull()
    expect(screen.getByRole("grid", { name: "808 step grid" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /Drum/ }).getAttribute("aria-selected")).toBe("true")
    // Seeded on first show.
    expect(getState().drums.pattern.hits.length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("radio", { name: "Synth track" }))
    expect(screen.getByRole("grid", { name: "Piano roll" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /Synth/ }).getAttribute("aria-selected")).toBe("true")
    expect(getState().pattern.notes).toEqual(notes)
  })
})
