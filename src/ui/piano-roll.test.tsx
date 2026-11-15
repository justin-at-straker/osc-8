import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { getState, setPattern, setStep } from "@/state/store"
import { PianoRoll } from "./piano-roll"
import { DEMO_PATTERN } from "./pattern-presets"

beforeEach(() => {
  act(() => {
    setPattern({ steps: 16, notes: [] })
    setStep(-1)
  })
})

describe("PianoRoll", () => {
  it("seeds the demo pattern when the store pattern is empty", () => {
    render(<PianoRoll />)
    expect(getState().pattern).toEqual(DEMO_PATTERN)
  })

  it("does not overwrite an existing pattern", () => {
    const mine = { steps: 16, notes: [{ step: 3, note: 60, length: 1, velocity: 1 }] }
    act(() => setPattern(mine))
    render(<PianoRoll />)
    expect(getState().pattern).toEqual(mine)
  })

  it("toggling a cell writes and removes a note", () => {
    render(<PianoRoll seed={false} />)
    fireEvent.click(screen.getByLabelText("C4, bar 1, step 5"))
    expect(getState().pattern.notes).toEqual([{ step: 4, note: 60, length: 1, velocity: 0.8 }])
    expect(screen.getByLabelText(/^C4, bar 1, step 5(,|$)/).getAttribute("aria-selected")).toBe("true")
    fireEvent.click(screen.getByLabelText(/^C4, bar 1, step 5(,|$)/))
    expect(getState().pattern.notes).toEqual([])
  })

  it("Shift+ArrowRight lengthens a note; held cells remove it", () => {
    render(<PianoRoll seed={false} />)
    fireEvent.click(screen.getByLabelText("E4, bar 1, step 1"))
    fireEvent.keyDown(screen.getByLabelText(/^E4, bar 1, step 1(,|$)/), { key: "ArrowRight", shiftKey: true })
    fireEvent.keyDown(screen.getByLabelText(/^E4, bar 1, step 1(,|$)/), { key: "ArrowRight", shiftKey: true })
    expect(getState().pattern.notes).toEqual([{ step: 0, note: 64, length: 3, velocity: 0.8 }])
    expect(screen.getByLabelText("E4, bar 1, step 3, held").getAttribute("aria-selected")).toBe("true")
    fireEvent.click(screen.getByLabelText("E4, bar 1, step 3, held"))
    expect(getState().pattern.notes).toEqual([])
  })

  it("writes notes at the chosen length", () => {
    render(<PianoRoll seed={false} />)
    fireEvent.click(screen.getByLabelText("Increase Note length (steps)"))
    fireEvent.click(screen.getByLabelText("G3, bar 1, step 16"))
    // Clipped to the end of the pattern.
    expect(getState().pattern.notes).toEqual([{ step: 15, note: 55, length: 1, velocity: 0.8 }])
    fireEvent.click(screen.getByLabelText("G3, bar 1, step 1"))
    expect(getState().pattern.notes[0]).toEqual({ step: 0, note: 55, length: 2, velocity: 0.8 })
  })

  it("shows the playhead column from the store step", () => {
    const { container } = render(<PianoRoll seed={false} />)
    expect(container.querySelectorAll("[role=gridcell][data-now]")).toHaveLength(0)
    act(() => setStep(6))
    const now = [...container.querySelectorAll<HTMLElement>("[role=gridcell][data-now]")]
    expect(now).toHaveLength(25)
    expect(now.every((el) => el.dataset.cell!.endsWith(":6"))).toBe(true)
  })
})
