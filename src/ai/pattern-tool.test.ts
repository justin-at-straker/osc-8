import { beforeEach, describe, expect, it } from "vitest"
import { applySetPattern } from "./tools"
import { getState, setPattern, setTransport, undo } from "@/state/store"

describe("setPattern tool", () => {
  beforeEach(() => {
    setPattern({ steps: 16, notes: [{ step: 0, note: 60, length: 1, velocity: 1 }] }, "load")
    setTransport({ bpm: 120 })
  })

  it("writes the pattern and tempo, sorted and de-duplicated", () => {
    const out = applySetPattern({
      notes: [
        { step: 8, note: 55, length: 2, velocity: 0.7 },
        { step: 0, note: 48, length: 3, velocity: 1 },
        { step: 8, note: 55, length: 1, velocity: 0.9 }, // duplicate of step 8 / note 55: last wins
      ],
      bpm: 174,
    })
    expect(out).toEqual({ ok: true, notes: 2, steps: 16, bpm: 174 })
    expect(getState().pattern.notes).toEqual([
      { step: 0, note: 48, length: 3, velocity: 1 },
      { step: 8, note: 55, length: 1, velocity: 0.9 },
    ])
  })

  it("is one undo step back to the previous notes", () => {
    applySetPattern({ notes: [{ step: 4, note: 50, length: 1, velocity: 1 }] })
    undo()
    expect(getState().pattern.notes).toEqual([{ step: 0, note: 60, length: 1, velocity: 1 }])
  })

  it("rejects notes outside the visible roll and leaves the pattern alone", () => {
    const before = getState().pattern
    const out = applySetPattern({ notes: [{ step: 0, note: 36, length: 1, velocity: 1 }] })
    expect(out.ok).toBe(false)
    expect(getState().pattern).toBe(before)
  })

  it("writes multi-bar patterns and rejects notes past the end", () => {
    const out = applySetPattern({ steps: 64, notes: [{ step: 0, note: 60, length: 4, velocity: 0.8 }, { step: 63, note: 64, length: 1, velocity: 0.8 }] })
    expect(out).toMatchObject({ ok: true, notes: 2, steps: 64 })
    expect(getState().pattern.steps).toBe(64)
    const bad = applySetPattern({ steps: 32, notes: [{ step: 40, note: 60, length: 1, velocity: 0.8 }] })
    expect(bad.ok).toBe(false)
    expect(getState().pattern.steps).toBe(64)
  })
})
