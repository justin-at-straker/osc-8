// The instrument is operable by the UI SDK agent alone: every control the AI
// needs shows up (snapshot or query) with a clear label and actions, and act
// on it changes the store, including cells in bars that aren't on screen.
import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentComponent } from "@ui-sdk/react/agent"
import { defaultKit } from "@/engine/drums"
import { defaultPatch } from "@/engine/patch"
import { getUiAgent } from "@/ai/ui-agent"
import { editKit, endGesture, getState, replacePatch, setDrumPattern, setPattern, setTransport } from "@/state/store"
import { OscPage } from "./osc-page"
import type { EngineControls } from "./types"

const engine = (): EngineControls => ({ start: vi.fn(() => Promise.resolve()), noteOn: vi.fn(), noteOff: vi.fn(), triggerDrum: vi.fn() })
const agent = getUiAgent()

beforeEach(() => {
  act(() => {
    replacePatch(defaultPatch(), "load")
    setPattern({ steps: 32, notes: [{ step: 0, note: 48, length: 2, velocity: 0.8 }] }, "load")
    setDrumPattern({ steps: 16, hits: [] }, "load")
    editKit(defaultKit(), "load")
    setTransport({ playing: false, bpm: 120 })
    endGesture()
  })
})

/** Every component the agent can find with this exact label (snapshot first, then query past the 100-entry cap). */
async function find(label: string): Promise<AgentComponent[]> {
  const queried = await agent.query({ text: label })
  const all = [...agent.snapshot(), ...(Array.isArray(queried) ? queried : [])]
  return all.filter((c) => c.label === label)
}

async function run(steps: { ref: string; action: string; args?: unknown[] }[]) {
  let result: Awaited<ReturnType<typeof agent.act>> | undefined
  await act(async () => {
    result = await agent.act({ steps })
  })
  if (!result!.ok) throw new Error(JSON.stringify(result!.error))
  return result!
}

describe("agent audit", () => {
  it("finds every control the AI needs, with actions, not off-page", async () => {
    render(<OscPage engine={engine()} audioGate={false} />)
    const labels = [
      // navigation
      "Front panel", "Synth pages", "Oscillator", "Modulation pages", "Drum voice",
      "Track", "Pattern length", "Pattern bar", "Follow playhead",
      "Play", "Tempo", "Master volume", "Undo", "Redo",
      "Previous preset", "Next preset",
      // the roll
      "Piano roll", "Note length (steps)", "Clear pattern",
      // knobs and switches on every page, including hidden ones
      "Filter cutoff", "Filter resonance", "Osc A position", "Osc B detune", "Osc A unison", "Sub level", "Noise color", "Amp release",
      "Reverb mix", "Delay feedback", "Distortion type", "EQ low",
      "LFO 1 division", "LFO 1 sync", "LFO 2 shape", "Env 2 attack",
      "Kick tune", "Snare snappy", "Drum swing",
      // mod routes without drag
      "New route source", "New route target", "New route amount", "Add route",
    ]
    const missing: string[] = []
    for (const label of labels) {
      const found = await find(label)
      if (found.length === 0) missing.push(label)
      else {
        expect(found[0].offPage, label).toBeFalsy()
        // Undo/Redo are disabled with nothing to undo; everything else takes actions.
        if (!found[0].disabled) expect(found[0].actions.length, label).toBeGreaterThan(0)
      }
    }
    expect(missing).toEqual([])
  }, 30_000)

  it("the piano roll is one component whose value is its lit cells, in every bar", async () => {
    render(<OscPage engine={engine()} audioGate={false} />)
    const [roll] = await find("Piano roll")
    expect(roll.actions).toEqual(expect.arrayContaining(["toggle", "add", "remove", "clear"]))
    expect(roll.value).toEqual(["C3, bar 1, step 1"])
  })

  it("toggle/add/remove write notes at the current note length, at absolute steps in any bar", async () => {
    render(<OscPage engine={engine()} audioGate={false} />)
    await run([{ ref: "Note length (steps)", action: "setValue", args: [3] }])
    await run([{ ref: "Piano roll", action: "toggle", args: ["C4, bar 2, step 5"] }])
    expect(getState().pattern.notes).toContainEqual({ step: 20, note: 60, length: 3, velocity: 0.8 })
    // Adding a lit cell changes nothing; remove takes it out; labels match any case.
    await run([{ ref: "Piano roll", action: "add", args: ["c4, bar 2, step 5"] }])
    expect(getState().pattern.notes.filter((n) => n.note === 60)).toHaveLength(1)
    await run([{ ref: "Piano roll", action: "remove", args: ["C4, bar 2, step 5"] }])
    expect(getState().pattern.notes.map((n) => n.step)).toEqual([0])
    // Unknown cells fail with a readable error.
    const bad = await agent.act({ steps: [{ ref: "Piano roll", action: "toggle", args: ["H9, bar 9, step 99"] }] })
    expect(bad.ok).toBe(false)
  })

  it("drum hits and accents through the drum grid", async () => {
    render(<OscPage engine={engine()} audioGate={false} />)
    await run([{ ref: "Track", action: "setValue", args: ["808"] }])
    await waitFor(async () => expect((await find("Drum grid")).length).toBe(1))
    act(() => setDrumPattern({ steps: 16, hits: [] }, "load"))
    await run([
      { ref: "Drum grid", action: "toggle", args: ["Kick, bar 1, step 1"] },
      { ref: "Drum grid", action: "accent", args: ["Snare, bar 1, step 5"] },
      { ref: "Drum pattern length", action: "setValue", args: ["2"] },
    ])
    expect(getState().drums.pattern.steps).toBe(32)
    expect(getState().drums.pattern.hits.map((h) => `${h.voice}@${h.step}${h.accent ? "!" : ""}`).sort()).toEqual(["kick@0", "kick@16", "snare@20!", "snare@4!"])
    await run([{ ref: "Drum grid", action: "remove", args: ["Kick, bar 2, step 1"] }])
    expect(getState().drums.pattern.hits.filter((h) => h.voice === "kick").map((h) => h.step)).toEqual([0])
  })

  it("adds a mod route with the form", async () => {
    render(<OscPage engine={engine()} audioGate={false} />)
    await run([
      { ref: "New route source", action: "setValue", args: ["LFO 2"] },
      { ref: "New route target", action: "setValue", args: ["Reverb mix"] },
      { ref: "New route amount", action: "setValue", args: [-40] },
      { ref: "Add route", action: "press" },
    ])
    expect(getState().patch.mod).toEqual([{ source: "lfo2", target: "fx.reverb.mix", amount: -0.4, aux: "none" }])
  })

  it("controls on hidden pages act directly, and the changed control glows", async () => {
    const { container } = render(<OscPage engine={engine()} audioGate={false} />)
    await run([{ ref: "Reverb mix", action: "setValue", args: [0.5] }])
    expect(getState().patch.fx.reverb.mix).toBe(0.5)
    await run([{ ref: "Filter cutoff", action: "setValue", args: [1000] }])
    expect(getState().patch.filter.cutoff).toBe(1000)
    expect(container.querySelector('[data-param="filter.cutoff"]')!.hasAttribute("data-agent-glow")).toBe(true)
    await run([{ ref: "Front panel", action: "setValue", args: ["FX"] }])
    expect(container.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toContain("FX")
  })

  it("pressed cells glow", async () => {
    const { container } = render(<OscPage engine={engine()} audioGate={false} />)
    await run([{ ref: "Piano roll", action: "toggle", args: ["D4, bar 1, step 3"] }])
    await waitFor(() => expect(container.querySelector('[data-cell="62:2"]')!.hasAttribute("data-agent-glow")).toBe(true))
  })
})
