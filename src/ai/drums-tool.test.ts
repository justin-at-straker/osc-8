import { beforeEach, describe, expect, it } from "vitest"
import { applySetDrums } from "./tools"
import { editKit, getState, setDrumPattern, undo } from "@/state/store"
import { defaultKit } from "@/engine/drums"

describe("setDrums tool", () => {
  beforeEach(() => {
    setDrumPattern({ steps: 16, hits: [{ step: 0, voice: "kick", velocity: 0.9, accent: false }] }, "load")
    editKit(defaultKit(), "load")
  })

  it("writes the beat, de-duplicated and sorted, plus kit edits", () => {
    const out = applySetDrums({
      hits: [
        { step: 4, voice: "snare", velocity: 0.8, accent: false },
        { step: 0, voice: "kick", velocity: 1, accent: true },
        { step: 4, voice: "snare", velocity: 0.9, accent: false },
      ],
      kit: { voices: { kick: { decay: 0.85 } }, swing: 0.3 },
    })
    expect(out).toMatchObject({ ok: true, hits: 2 })
    expect(getState().drums.pattern.hits.map((h) => `${h.step}:${h.voice}`)).toEqual(["0:kick", "4:snare"])
    expect(getState().drums.kit.voices.kick.decay).toBe(0.85)
    expect(getState().drums.kit.voices.kick.tune).toBe(0.5) // untouched field kept
    expect(getState().drums.kit.swing).toBe(0.3)
  })

  it("rejects unknown voices and out-of-range kit values without changing anything", () => {
    const before = getState().drums
    expect(applySetDrums({ hits: [{ step: 0, voice: "tabla", velocity: 1, accent: false }] }).ok).toBe(false)
    expect(applySetDrums({ kit: { swing: 3 } }).ok).toBe(false)
    expect(getState().drums).toBe(before)
  })

  it("undo restores the previous beat", () => {
    applySetDrums({ hits: [{ step: 8, voice: "clap", velocity: 0.8, accent: false }] })
    undo()
    expect(getState().drums.pattern.hits).toEqual([{ step: 0, voice: "kick", velocity: 0.9, accent: false }])
  })
})
