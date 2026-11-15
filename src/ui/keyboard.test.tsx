import { act, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getState, setAudio, setStep, setTransport } from "@/state/store"
import { AudioGate } from "./audio-gate"
import { Transport } from "./transport"
import { useQwertyKeyboard } from "./use-qwerty-keyboard"
import type { EngineControls } from "./types"

const stubEngine = () => ({
  start: vi.fn(() => Promise.resolve()),
  noteOn: vi.fn(),
  noteOff: vi.fn(),
}) satisfies EngineControls

beforeEach(() => {
  act(() => {
    setTransport({ playing: false, bpm: 120 })
    setStep(-1)
    setAudio("off")
  })
})

describe("useQwertyKeyboard", () => {
  it("plays a note once per press, ignoring repeats", () => {
    const engine = stubEngine()
    renderHook(() => useQwertyKeyboard(engine))
    fireEvent.keyDown(window, { key: "a", code: "KeyA" })
    fireEvent.keyDown(window, { key: "a", code: "KeyA", repeat: true })
    fireEvent.keyUp(window, { key: "a", code: "KeyA" })
    expect(engine.noteOn).toHaveBeenCalledTimes(1)
    expect(engine.noteOn).toHaveBeenCalledWith(60, expect.any(Number))
    expect(engine.noteOff).toHaveBeenCalledTimes(1)
    expect(engine.noteOff).toHaveBeenCalledWith(60)
  })

  it("shifts octave with Z and X, and releases the note it started", () => {
    const engine = stubEngine()
    const { result } = renderHook(() => useQwertyKeyboard(engine))
    fireEvent.keyDown(window, { key: "k", code: "KeyK" })
    fireEvent.keyDown(window, { key: "x", code: "KeyX" })
    expect(result.current.octave).toBe(5)
    fireEvent.keyUp(window, { key: "k", code: "KeyK" })
    expect(engine.noteOn).toHaveBeenCalledWith(72, expect.any(Number))
    expect(engine.noteOff).toHaveBeenCalledWith(72)
    fireEvent.keyDown(window, { key: "w", code: "KeyW" })
    expect(engine.noteOn).toHaveBeenLastCalledWith(73, expect.any(Number))
  })

  it("ignores typing in text inputs", () => {
    const engine = stubEngine()
    renderHook(() => useQwertyKeyboard(engine))
    const input = document.createElement("input")
    document.body.append(input)
    fireEvent.keyDown(input, { key: "a", code: "KeyA" })
    expect(engine.noteOn).not.toHaveBeenCalled()
    input.remove()
  })
})

describe("Transport", () => {
  it("toggles play from the key and from Space", () => {
    const engine = stubEngine()
    render(<Transport engine={engine} />)
    fireEvent.click(screen.getByLabelText("Play"))
    expect(getState().transport.playing).toBe(true)
    expect(engine.start).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document.body, { key: " ", code: "Space" })
    expect(getState().transport.playing).toBe(false)
  })

  it("shows tempo and step, and sets tempo from its knob", () => {
    render(<Transport />)
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Tempo 120 BPM, step stopped")
    act(() => setStep(3))
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Tempo 120 BPM, step 4")
    fireEvent.keyDown(screen.getByLabelText("Tempo"), { key: "End" })
    expect(getState().transport.bpm).toBe(200)
  })
})

describe("AudioGate", () => {
  it("starts audio and hides once on", async () => {
    const engine = stubEngine()
    const { container } = render(<AudioGate engine={engine} />)
    fireEvent.click(screen.getByLabelText("Tap to start audio"))
    expect(engine.start).toHaveBeenCalledTimes(1)
    act(() => setAudio("starting"))
    expect(screen.getByLabelText("Starting audio")).toBeTruthy()
    act(() => setAudio("on"))
    expect(container.innerHTML).toBe("")
  })

  it("shows a failed start", async () => {
    const engine = { ...stubEngine(), start: vi.fn(() => Promise.reject(new Error("no worklet"))) }
    render(<AudioGate engine={engine} />)
    await act(async () => fireEvent.click(screen.getByLabelText("Tap to start audio")))
    expect(screen.getByLabelText("Audio failed to start. Tap to retry")).toBeTruthy()
    expect(screen.getByText("no worklet")).toBeTruthy()
  })
})
