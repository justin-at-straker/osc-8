import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { defaultPatch, Patch } from "@/engine/patch"
import { getState, replacePatch, undo } from "@/state/store"
import { FrontPanel } from "./front-panel"
import { PresetBrowser } from "./preset-browser"
import { isModified, presetIndexOf } from "./preset-state"
import { FACTORY_PRESETS, PRESET_CATEGORIES, presetCategory } from "./presets"

beforeEach(() => {
  act(() => void replacePatch(defaultPatch(), "load"))
})

const readout = () => screen.getByRole("status").getAttribute("aria-label")

describe("FACTORY_PRESETS", () => {
  it("every preset is a valid patch with a stable factory id and a known category", () => {
    expect(FACTORY_PRESETS.length).toBeGreaterThanOrEqual(10)
    for (const p of FACTORY_PRESETS) {
      expect(() => Patch.parse(p), p.name).not.toThrow()
      expect(p.id).toMatch(/^factory\/[a-z0-9-]+$/)
      expect(Object.keys(PRESET_CATEGORIES)).toContain(presetCategory(p))
    }
    expect(new Set(FACTORY_PRESETS.map((p) => p.id)).size).toBe(FACTORY_PRESETS.length)
    expect(new Set(FACTORY_PRESETS.map((p) => p.name)).size).toBe(FACTORY_PRESETS.length)
  })

  it("presets actually differ from init and each other", () => {
    const sound = (p: Patch) => JSON.stringify({ ...p, id: "", name: "" })
    expect(new Set(FACTORY_PRESETS.map(sound)).size).toBe(FACTORY_PRESETS.length)
    expect(FACTORY_PRESETS.map(sound)).not.toContain(sound(defaultPatch()))
  })
})

describe("PresetBrowser", () => {
  it("next and previous load presets, each one undo step", () => {
    render(<PresetBrowser />)
    const before = getState().patch
    fireEvent.click(screen.getByLabelText("Next preset"))
    expect(getState().patch.name).toBe(FACTORY_PRESETS[0].name)
    expect(getState().patch.id).not.toBe(FACTORY_PRESETS[0].id)
    expect(presetIndexOf(getState().patch)).toBe(0)
    expect(readout()).toBe(`Patch ${FACTORY_PRESETS[0].name}`)

    fireEvent.click(screen.getByLabelText("Next preset"))
    expect(getState().patch.name).toBe(FACTORY_PRESETS[1].name)
    fireEvent.click(screen.getByLabelText("Previous preset"))
    fireEvent.click(screen.getByLabelText("Previous preset"))
    expect(getState().patch.name).toBe(FACTORY_PRESETS.at(-1)!.name)

    act(() => undo())
    expect(getState().patch.name).toBe(FACTORY_PRESETS[0].name)
    // Four loads, four undo steps back to where we started.
    act(() => undo())
    expect(getState().patch.name).toBe(FACTORY_PRESETS[1].name)
    act(() => undo())
    act(() => undo())
    expect(getState().patch).toBe(before)
  })

  it("marks the patch modified after a knob change, and clean again on undo", () => {
    render(
      <>
        <PresetBrowser />
        <FrontPanel />
      </>
    )
    fireEvent.click(screen.getByLabelText("Next preset"))
    expect(readout()).toBe(`Patch ${FACTORY_PRESETS[0].name}`)
    expect(screen.queryByText("*")).toBeNull()

    fireEvent.keyDown(screen.getByLabelText("Filter cutoff"), { key: "ArrowUp" })
    expect(readout()).toBe(`Patch ${FACTORY_PRESETS[0].name}, modified`)
    expect(screen.getByText("*")).toBeTruthy()
    expect(isModified(getState().patch)).toBe(true)

    act(() => undo())
    expect(readout()).toBe(`Patch ${FACTORY_PRESETS[0].name}`)
  })

  it("picks a preset from the list", () => {
    render(<PresetBrowser />)
    fireEvent.click(screen.getByLabelText("Preset list"))
    fireEvent.click(screen.getByRole("menuitem", { name: "PD Halo Drift" }))
    expect(getState().patch.name).toBe("PD Halo Drift")
    expect(getState().patch.env1.attack).toBeGreaterThan(1)
  })
})
