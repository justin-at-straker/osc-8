import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defaultPatch } from "@/engine/patch"
import { getState, replacePatch, setPatchValue } from "@/state/store"
import { FrontPanel } from "./front-panel"
import { selectRoute } from "./mod-model"
import { ModSourceStrip } from "./mod-ui"
import { SynthPanel } from "./synth-panel"
import { Transport } from "./transport"

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

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const dialOf = (container: HTMLElement, path: string) => container.querySelector<HTMLElement>(`[data-param="${path}"] [data-kit="knob-dial"]`)!

describe("SYNTH oscillators", () => {
  it("labels and tags every new control", () => {
    const { container } = render(<SynthPanel />)
    for (const osc of ["Osc A", "Osc B"]) {
      for (const what of ["enabled", "table", "position", "level", "octave", "semitone", "fine tune", "pan", "unison", "detune", "blend", "spread", "phase", "random phase", "to filter"]) {
        expect(screen.getAllByLabelText(`${osc} ${what}`).length, `${osc} ${what}`).toBeGreaterThan(0)
      }
    }
    for (const label of ["Sub enabled", "Sub level", "Sub octave", "Sub shape", "Noise enabled", "Noise level", "Noise color", "Noise to filter"]) {
      expect(screen.getAllByLabelText(label).length, label).toBeGreaterThan(0)
    }
    const params = new Set([...container.querySelectorAll("[data-param]")].map((el) => el.getAttribute("data-param")))
    for (const f of ["enabled", "table", "position", "level", "octave", "semi", "fine", "pan", "unison", "detune", "blend", "spread", "phase", "randomPhase", "toFilter"]) {
      expect(params.has(`oscA.${f}`), `oscA.${f}`).toBe(true)
      expect(params.has(`oscB.${f}`), `oscB.${f}`).toBe(true)
    }
    for (const path of ["sub.enabled", "sub.level", "sub.octave", "sub.shape", "noise.enabled", "noise.level", "noise.color", "noise.toFilter"]) {
      expect(params.has(path), path).toBe(true)
    }
  })

  it("new controls write the store", () => {
    render(<SynthPanel />)
    fireEvent.keyDown(input("Osc B position"), { key: "End" })
    expect(getState().patch.oscB.position).toBe(1)
    fireEvent.keyDown(input("Osc A spread"), { key: "Home" })
    expect(getState().patch.oscA.spread).toBe(0)
    fireEvent.keyDown(input("Osc A pan"), { key: "Home" })
    expect(getState().patch.oscA.pan).toBe(-1)
    fireEvent.click(screen.getByLabelText("Increase Osc B semitone"))
    expect(getState().patch.oscB.semi).toBe(1)
    fireEvent.click(screen.getByLabelText("Osc A to filter"))
    expect(getState().patch.oscA.toFilter).toBe(false)

    fireEvent.click(screen.getByRole("tab", { name: "Sub, noise and amp envelope" }))
    fireEvent.click(screen.getByRole("radio", { name: "-2" }))
    expect(getState().patch.sub.octave).toBe(-2)
    fireEvent.click(screen.getByRole("radio", { name: "square" }))
    expect(getState().patch.sub.shape).toBe("square")
    fireEvent.keyDown(input("Noise color"), { key: "End" })
    expect(getState().patch.noise.color).toBe(1)
    fireEvent.click(screen.getByLabelText("Noise enabled"))
    expect(getState().patch.noise.enabled).toBe(true)
  })

  it("new controls follow store changes, with readable readouts", () => {
    const { container } = render(<SynthPanel />)
    act(() => void setPatchValue("oscA.detune", 0.6, "ai"))
    expect(input("Osc A detune").value).toBe("60%")
    act(() => void setPatchValue("oscB.pan", -0.4, "ai"))
    expect(container.querySelector('[data-param="oscB.pan"] [data-osc-readout-text]')?.textContent).toBe("L40")
    act(() => void setPatchValue("noise.color", 0.2, "ai"))
    expect(container.querySelector('[data-param="noise.color"] [data-osc-readout-text]')?.textContent).toBe("dark 60")
    act(() => void setPatchValue("noise.color", 0.5, "ai"))
    expect(container.querySelector('[data-param="noise.color"] [data-osc-readout-text]')?.textContent).toBe("white")
    act(() => void setPatchValue("sub.octave", 0, "ai"))
    expect(screen.getByRole("radio", { name: "0", hidden: true }).getAttribute("aria-checked")).toBe("true")
    act(() => void setPatchValue("oscB.enabled", true, "ai"))
    expect(screen.getByLabelText("Osc B enabled").getAttribute("aria-checked")).toBe("true")
  })

  it("unison snaps to whole voices 1..16 and lights its LEDs", () => {
    const { container } = render(<SynthPanel />)
    const voices = input("Osc A unison")
    fireEvent.focus(voices)
    fireEvent.change(voices, { target: { value: "7.6" } })
    fireEvent.blur(voices)
    expect(getState().patch.oscA.unison).toBe(8)
    fireEvent.keyDown(voices, { key: "End" })
    expect(getState().patch.oscA.unison).toBe(16)
    fireEvent.keyDown(voices, { key: "Home" })
    expect(getState().patch.oscA.unison).toBe(1)
    fireEvent.keyDown(voices, { key: "ArrowUp", shiftKey: true })
    expect(Number.isInteger(getState().patch.oscA.unison)).toBe(true)

    act(() => void setPatchValue("oscA.unison", 5, "ai"))
    const leds = container.querySelector('[aria-label="Osc A"] [data-osc-unison-leds]')!
    expect(leds.querySelectorAll("i[data-on]")).toHaveLength(5)
    expect(leds.textContent).toBe("x5")
  })

  it("enables osc B from its header switch, and its A/B key lights", () => {
    const { container } = render(<SynthPanel />)
    fireEvent.click(screen.getByRole("tab", { name: "Oscillator B" }))
    const bLed = () => container.querySelector('[aria-label="Oscillator B"] [data-osc-ab-led]')!
    expect(bLed().hasAttribute("data-on")).toBe(false)
    expect(container.querySelector('[aria-label="Osc B"] [data-osc-controls]')!.hasAttribute("data-off")).toBe(true)
    fireEvent.click(screen.getByRole("switch", { name: "Osc B enabled" }))
    expect(getState().patch.oscB.enabled).toBe(true)
    expect(bLed().hasAttribute("data-on")).toBe(true)
    expect(container.querySelector('[aria-label="Osc B"] [data-osc-controls]')!.hasAttribute("data-off")).toBe(false)
  })

  it("switching sub-pages and oscillators keeps values", () => {
    render(<SynthPanel />)
    fireEvent.click(screen.getByRole("tab", { name: "Sub, noise and amp envelope" }))
    fireEvent.keyDown(input("Sub level"), { key: "End" })
    fireEvent.click(screen.getByRole("tab", { name: "Oscillators and filter" }))
    fireEvent.click(screen.getByRole("tab", { name: "Oscillator B" }))
    fireEvent.keyDown(input("Osc B level"), { key: "Home" })
    fireEvent.click(screen.getByRole("tab", { name: "Oscillator A" }))
    fireEvent.click(screen.getByRole("tab", { name: "Sub, noise and amp envelope" }))
    expect(input("Sub level").value).toBe("100%")
    fireEvent.click(screen.getByRole("tab", { name: "Oscillators and filter" }))
    fireEvent.click(screen.getByRole("tab", { name: "Oscillator B" }))
    expect(input("Osc B level").value).toBe("0%")
    expect(getState().patch.sub.level).toBe(1)
    expect(getState().patch.oscB.level).toBe(0)
  })

  it("new mod targets accept drops and the context menu", () => {
    const { container } = render(
      <>
        <ModSourceStrip />
        <FrontPanel />
      </>
    )
    const drop = (source: string, path: string) => {
      document.elementFromPoint = () => dialOf(container, path)
      fireEvent.pointerDown(screen.getAllByLabelText(`${source} source`)[0], { button: 0, pointerId: 4 })
      fireEvent.pointerMove(window, { pointerId: 4, clientX: 3, clientY: 3 })
      act(() => void fireEvent.pointerUp(window, { pointerId: 4 }))
    }
    drop("LFO 1", "oscB.detune")
    drop("Env 2", "noise.color")
    drop("LFO 3", "oscA.spread")
    // Not a mod target: nothing happens.
    drop("LFO 3", "oscA.phase")
    fireEvent.click(screen.getByRole("tab", { name: "Sub, noise and amp envelope" }))
    fireEvent.contextMenu(dialOf(container, "sub.level"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Velocity" }))
    expect(getState().patch.mod.map((r) => `${r.source}>${r.target}`)).toEqual([
      "lfo1>oscB.detune",
      "env2>noise.color",
      "lfo3>oscA.spread",
      "velocity>sub.level",
    ])
    expect(container.querySelector('[data-mod-target="oscA.spread"] [data-osc-mod-ring]')).not.toBeNull()
  })
})

describe("Transport master volume", () => {
  it("writes and follows the store, and is a mod target", () => {
    const { container } = render(<Transport />)
    fireEvent.keyDown(input("Master volume"), { key: "Home" })
    expect(getState().patch.master.volume).toBe(0)
    act(() => void setPatchValue("master.volume", 0.5, "ai"))
    expect(input("Master volume").value).toBe("50%")
    expect(container.querySelector('[data-mod-target="master.volume"]')).not.toBeNull()
  })
})
