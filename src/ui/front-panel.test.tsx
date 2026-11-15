import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { defaultPatch } from "@/engine/patch"
import { getState, replacePatch, setPatchValue, undo } from "@/state/store"
import { FrontPanel } from "./front-panel"

beforeEach(() => {
  act(() => void replacePatch(defaultPatch()))
})

const fxTab = () => screen.getByRole("tab", { name: /FX/ })
const synthTab = () => screen.getByRole("tab", { name: /Synth/ })

describe("FrontPanel FX page", () => {
  it("labels every FX control and tags it with its patch path", () => {
    const { container } = render(<FrontPanel />)
    for (const label of ["Distortion type", "Distortion drive", "Chorus rate", "Delay feedback", "Delay time", "Delay ping-pong", "Reverb mix", "OTT depth", "EQ low", "Reverb enabled"]) {
      expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0)
    }
    const params = new Set([...container.querySelectorAll("[data-param]")].map((el) => el.getAttribute("data-param")))
    for (const path of [
      "fx.distortion.enabled", "fx.distortion.type", "fx.distortion.drive", "fx.distortion.mix",
      "fx.chorus.enabled", "fx.chorus.rate", "fx.chorus.depth", "fx.chorus.mix",
      "fx.delay.enabled", "fx.delay.time", "fx.delay.feedback", "fx.delay.mix", "fx.delay.pingPong",
      "fx.reverb.enabled", "fx.reverb.size", "fx.reverb.decay", "fx.reverb.damping", "fx.reverb.mix",
      "fx.ott.enabled", "fx.ott.depth", "fx.ott.time",
      "fx.eq.enabled", "fx.eq.low", "fx.eq.mid", "fx.eq.high",
    ]) {
      expect(params.has(path), path).toBe(true)
    }
  })

  it("FX knobs, switches and mode selectors write the patch", () => {
    render(<FrontPanel />)
    fireEvent.click(fxTab())
    fireEvent.keyDown(screen.getByLabelText("Delay feedback"), { key: "End" })
    expect(getState().patch.fx.delay.feedback).toBe(1)
    fireEvent.keyDown(screen.getByLabelText("EQ low"), { key: "ArrowUp", shiftKey: true })
    expect(getState().patch.fx.eq.low).toBeCloseTo(2.4, 5)
    fireEvent.click(screen.getByLabelText("Reverb enabled"))
    expect(getState().patch.fx.reverb.enabled).toBe(true)
    fireEvent.click(screen.getByRole("radio", { name: "fold" }))
    expect(getState().patch.fx.distortion.type).toBe("fold")
    fireEvent.click(screen.getByRole("radio", { name: "1/16" }))
    expect(getState().patch.fx.delay.time).toBe("1/16")
  })

  it("FX controls follow store changes, with readable readouts", () => {
    const { container } = render(<FrontPanel />)
    fireEvent.click(fxTab())
    act(() => void setPatchValue("fx.eq.mid", 3, "ai"))
    const mid = container.querySelector('[data-param="fx.eq.mid"]')!
    expect(mid.querySelector("[data-osc-readout-text]")?.textContent).toBe("+3.0dB")
    expect((screen.getByLabelText("EQ mid") as HTMLInputElement).value).toBe("+3.0")
    act(() => void setPatchValue("fx.chorus.rate", 1.6, "ai"))
    expect(container.querySelector('[data-param="fx.chorus.rate"] [data-osc-readout-text]')?.textContent).toBe("1.6Hz")
    act(() => void setPatchValue("fx.delay.time", "1/4t", "ai"))
    expect(screen.getByRole("radio", { name: "1/4t" }).getAttribute("aria-checked")).toBe("true")
    act(() => void setPatchValue("fx.reverb.mix", 0.6, "ai"))
    expect((screen.getByLabelText("Reverb mix") as HTMLInputElement).value).toBe("60%")
  })

  it("dims a disabled effect's controls, and lights the FX tab when any effect is on", () => {
    const { container } = render(<FrontPanel />)
    const delay = container.querySelector('[aria-label="Delay"] [data-osc-controls]')!
    const led = container.querySelector("[data-osc-tab-led]")!
    expect(delay.hasAttribute("data-off")).toBe(true)
    expect(led.hasAttribute("data-on")).toBe(false)
    act(() => void setPatchValue("fx.delay.enabled", true))
    expect(delay.hasAttribute("data-off")).toBe(false)
    expect(led.hasAttribute("data-on")).toBe(true)
  })

  it("switching tabs keeps values", () => {
    render(<FrontPanel />)
    fireEvent.click(fxTab())
    fireEvent.keyDown(screen.getByLabelText("Reverb size"), { key: "Home" })
    fireEvent.click(synthTab())
    fireEvent.keyDown(screen.getByLabelText("Master volume"), { key: "End" })
    fireEvent.click(fxTab())
    expect((screen.getByLabelText("Reverb size") as HTMLInputElement).value).toBe("0%")
    fireEvent.click(synthTab())
    expect((screen.getByLabelText("Master volume") as HTMLInputElement).value).toBe("100%")
    expect(getState().patch.fx.reverb.size).toBe(0)
    expect(getState().patch.master.volume).toBe(1)
  })

  it("Ctrl+Z and Ctrl+Shift+Z undo and redo", () => {
    render(<FrontPanel />)
    // "agent", so it isn't coalesced with the previous test's volume gesture.
    act(() => void setPatchValue("master.volume", 0.2, "agent"))
    fireEvent.keyDown(window, { key: "z", ctrlKey: true })
    expect(getState().patch.master.volume).toBe(0.7)
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true })
    expect(getState().patch.master.volume).toBe(0.2)
    act(() => undo())
  })
})
