import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { defaultPatch } from "@/engine/patch"
import { getState, replacePatch, setPatchValue, undo } from "@/state/store"
import { SynthPanel } from "./synth-panel"
import { fromTravel, LOG, toTravel } from "./taper"

beforeEach(() => {
  act(() => void replacePatch(defaultPatch()))
})

describe("SynthPanel", () => {
  it("labels every M1 control and tags it with its patch path", () => {
    const { container } = render(<SynthPanel />)
    for (const label of ["Filter cutoff", "Filter resonance", "Osc A position", "Osc A level", "Amp attack", "Master volume", "Osc A octave"]) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
    const params = [...container.querySelectorAll("[data-param]")].map((el) => el.getAttribute("data-param"))
    expect(params).toEqual(
      expect.arrayContaining([
        "oscA.table", "oscA.position", "oscA.level", "oscA.octave", "oscA.semi", "oscA.fine",
        "filter.enabled", "filter.cutoff", "filter.resonance",
        "env1.attack", "env1.decay", "env1.sustain", "env1.release", "master.volume",
      ])
    )
    expect(container.querySelector('[data-param="filter.cutoff"]')?.contains(screen.getByLabelText("Filter cutoff"))).toBe(true)
  })

  it("turning the cutoff knob writes the patch", () => {
    render(<SynthPanel />)
    const cutoff = screen.getByLabelText("Filter cutoff")
    fireEvent.keyDown(cutoff, { key: "ArrowUp" })
    const expected = Math.round(fromTravel(toTravel(4000, 20, 20000, LOG) + 0.01, 20, 20000, LOG))
    expect(getState().patch.filter.cutoff).toBe(expected)
    expect(getState().patch.filter.cutoff).toBeGreaterThan(4000)
  })

  it("dragging a knob's dial writes the patch", () => {
    const { container } = render(<SynthPanel />)
    const dial = container.querySelector('[data-param="master.volume"] [data-kit="knob-dial"]')!
    fireEvent.pointerDown(dial, { button: 0, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(dial, { clientY: 178, pointerId: 1 })
    fireEvent.pointerUp(dial, { pointerId: 1 })
    expect(getState().patch.master.volume).toBeCloseTo(0.8, 2)
  })

  it("typing into a knob's readout writes the patch (how the UI SDK agent sets it)", () => {
    render(<SynthPanel />)
    const res = screen.getByLabelText("Filter resonance") as HTMLInputElement
    fireEvent.focus(res)
    fireEvent.change(res, { target: { value: "55%" } })
    fireEvent.blur(res)
    expect(getState().patch.filter.resonance).toBeCloseTo(0.55, 5)
  })

  it("reflects store changes, including undo", () => {
    render(<SynthPanel />)
    const cutoff = screen.getByLabelText("Filter cutoff") as HTMLInputElement
    expect(cutoff.value).toBe("4K")
    act(() => void setPatchValue("filter.cutoff", 1200, "ai"))
    expect(cutoff.value).toBe("1.2K")
    expect(cutoff.getAttribute("aria-valuenow") ?? "1200").toBe("1200")
    act(() => undo())
    expect(cutoff.value).toBe("4K")

    act(() => void setPatchValue("oscA.octave", -2, "ai"))
    expect((screen.getByLabelText("Osc A octave") as HTMLInputElement).value).toBe("-2")
    act(() => void setPatchValue("filter.enabled", false, "ai"))
    expect(screen.getByLabelText("Filter enabled").getAttribute("aria-checked")).toBe("false")
  })

  it("steps octave and switches filter and table", () => {
    render(<SynthPanel />)
    fireEvent.click(screen.getByLabelText("Increase Osc A octave"))
    expect(getState().patch.oscA.octave).toBe(1)
    fireEvent.click(screen.getByLabelText("Filter enabled"))
    expect(getState().patch.filter.enabled).toBe(false)
    fireEvent.click(screen.getByRole("radio", { name: "PWM" }))
    expect(getState().patch.oscA.table).toEqual({ kind: "builtin", name: "pwm" })
  })
})
