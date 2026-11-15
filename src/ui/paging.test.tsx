import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { defaultKit } from "@/engine/drums"
import { defaultPatch } from "@/engine/patch"
import { editKit, endGesture, getState, replacePatch, setDrumPattern, setPattern, setStep, setTransport, undo } from "@/state/store"
import { DrumGrid } from "./drum-grid"
import { resize, setFollow, setPage } from "./pattern-paging"
import { PianoRoll } from "./piano-roll"
import { Transport } from "./transport"

const n = (step: number, note = 60, length = 1) => ({ step, note, length, velocity: 0.8 })

beforeEach(() => {
  act(() => {
    replacePatch(defaultPatch(), "load")
    setPattern({ steps: 16, notes: [] }, "load")
    setDrumPattern({ steps: 16, hits: [] }, "load")
    editKit(defaultKit(), "load")
    setTransport({ playing: false })
    setStep(-1)
    for (const t of ["synth", "808"] as const) {
      setPage(t, 0)
      setFollow(t, true)
    }
    endGesture()
  })
})

const pick = (group: string, name: string) => fireEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name }))
const selected = (name: string) => screen.getByRole("gridcell", { name: new RegExp(`^${name}(,|$)`) }).getAttribute("aria-selected")

describe("resize", () => {
  it("repeats the pattern to fill a longer length, and drops what starts past a shorter end", () => {
    expect(resize([n(0), n(5, 62, 4)], 16, 64).map((x) => x.step)).toEqual([0, 5, 16, 21, 32, 37, 48, 53])
    expect(resize([n(0), n(20), n(40)], 64, 32).map((x) => x.step)).toEqual([0, 20])
    // Lengths are kept even when they run past the end (they wrap).
    expect(resize([n(14, 60, 6)], 32, 16)).toEqual([n(14, 60, 6)])
  })
})

describe("pattern length", () => {
  it("lengthening repeats bar 1 and is one undo step", () => {
    act(() => setPattern({ steps: 16, notes: [n(0), n(4, 64)] }, "load"))
    render(<PianoRoll seed={false} />)
    pick("Pattern length", "4 bars")
    expect(getState().pattern.steps).toBe(64)
    expect(getState().pattern.notes.map((x) => x.step)).toEqual([0, 4, 16, 20, 32, 36, 48, 52])
    act(() => undo())
    expect(getState().pattern).toEqual({ steps: 16, notes: [n(0), n(4, 64)] })
  })

  it("shortening drops notes past the new end, as one undo step", () => {
    const long = { steps: 32, notes: [n(3), n(20, 67)] }
    act(() => setPattern(long, "load"))
    render(<PianoRoll seed={false} />)
    pick("Pattern length", "1 bar")
    expect(getState().pattern).toEqual({ steps: 16, notes: [n(3)] })
    act(() => undo())
    expect(getState().pattern).toEqual(long)
  })

  it("the drum grid's length works the same", () => {
    act(() => setDrumPattern({ steps: 16, hits: [{ step: 4, voice: "snare", velocity: 0.8, accent: false }] }, "load"))
    render(<DrumGrid seed={false} />)
    pick("Drum pattern length", "8 bars")
    expect(getState().drums.pattern.steps).toBe(128)
    expect(getState().drums.pattern.hits.map((h) => h.step)).toEqual([4, 20, 36, 52, 68, 84, 100, 116])
    act(() => undo())
    expect(getState().drums.pattern.steps).toBe(16)
  })
})

describe("paging", () => {
  it("shows one bar at a time, with bar numbers in the cell names", () => {
    act(() => setPattern({ steps: 32, notes: [n(20)] }, "load"))
    const { container } = render(<PianoRoll seed={false} />)
    expect(container.querySelector('[role="row"]')!.querySelectorAll('[role="gridcell"]').length).toBe(16)
    expect(selected("C4, bar 1, step 5")).toBe("false")
    pick("Pattern bar", "Bar 2")
    expect(selected("C4, bar 2, step 5")).toBe("true")
    // Cells keep absolute steps: clicking bar 2, step 9 writes step 24.
    fireEvent.click(screen.getByRole("gridcell", { name: "D4, bar 2, step 9" }))
    expect(getState().pattern.notes.map((x) => x.step)).toEqual([20, 24])
  })

  it("the overview jumps to a bar", () => {
    act(() => setPattern({ steps: 64, notes: [n(40)] }, "load"))
    render(<PianoRoll seed={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Show bar 3" }))
    expect(selected("C4, bar 3, step 9")).toBe("true")
  })

  it("the playhead column shows only in its bar", () => {
    act(() => setPattern({ steps: 32, notes: [] }, "load"))
    const { container } = render(<PianoRoll seed={false} />)
    act(() => setStep(20))
    expect(container.querySelectorAll("[role=gridcell][data-now]")).toHaveLength(0)
    pick("Pattern bar", "Bar 2")
    expect(container.querySelectorAll("[role=gridcell][data-now]")).toHaveLength(25)
  })

  it("arrow keys page across bar boundaries", () => {
    act(() => setPattern({ steps: 32, notes: [] }, "load"))
    render(<PianoRoll seed={false} />)
    const last = screen.getByRole("gridcell", { name: "C4, bar 1, step 16" })
    last.focus()
    fireEvent.keyDown(last, { key: "ArrowRight" })
    const first = screen.getByRole("gridcell", { name: "C4, bar 2, step 1" })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: "ArrowLeft" })
    expect(document.activeElement).toBe(screen.getByRole("gridcell", { name: "C4, bar 1, step 16" }))
  })
})

describe("follow", () => {
  it("pages with the playhead; a manual bar turns it off until play restarts or the key is pressed", () => {
    act(() => setPattern({ steps: 64, notes: [] }, "load"))
    render(<PianoRoll seed={false} />)
    const follow = () => screen.getByRole("button", { name: "Follow playhead" })
    expect(follow().getAttribute("aria-pressed")).toBe("true")
    act(() => {
      setTransport({ playing: true })
      setStep(37)
    })
    expect(screen.getByRole("gridcell", { name: "C4, bar 3, step 6" })).toBeTruthy()

    pick("Pattern bar", "Bar 1")
    expect(follow().getAttribute("aria-pressed")).toBe("false")
    act(() => setStep(50))
    expect(screen.getByRole("gridcell", { name: "C4, bar 1, step 1" })).toBeTruthy()

    fireEvent.click(follow())
    expect(screen.getByRole("gridcell", { name: "C4, bar 4, step 3" })).toBeTruthy()

    pick("Pattern bar", "Bar 2")
    act(() => setTransport({ playing: false }))
    act(() => {
      setTransport({ playing: true })
      setStep(1)
    })
    expect(follow().getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("gridcell", { name: "C4, bar 1, step 2" })).toBeTruthy()
  })

  it("the drum grid follows too, wrapping the step into its own length", () => {
    act(() => setDrumPattern({ steps: 128, hits: [] }, "load"))
    render(<DrumGrid seed={false} />)
    act(() => {
      setTransport({ playing: true })
      setStep(100)
    })
    expect(screen.getByRole("gridcell", { name: "Kick, bar 7, step 5" })).toBeTruthy()
    pick("Drum pattern bar", "Bar 2")
    expect(screen.getByRole("button", { name: "Follow playhead (drums)" }).getAttribute("aria-pressed")).toBe("false")
    expect(screen.getByRole("gridcell", { name: "Kick, bar 2, step 5" })).toBeTruthy()
  })
})

describe("LCD position", () => {
  it("shows bar.step for patterns longer than a bar", () => {
    render(<Transport />)
    act(() => setStep(4))
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Tempo 120 BPM, step 5")
    act(() => setPattern({ steps: 64, notes: [] }, "load"))
    act(() => setStep(21))
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Tempo 120 BPM, step bar 2 step 6")
    expect(screen.getByRole("status").textContent).toContain("2.06")
    expect(screen.getByRole("status").textContent).toContain("/4")
  })
})
