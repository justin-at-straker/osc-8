import { beforeEach, describe, expect, it } from "vitest"
import { clearStartup, hasStartup, loadStartup, saveStartup } from "./startup"
import { editPatch, setPattern, setTransport } from "./store"

describe("startup default", () => {
  beforeEach(() => clearStartup())

  it("round-trips the session", () => {
    editPatch({ name: "Mine", filter: { cutoff: 900 } })
    setPattern({ steps: 32, notes: [{ step: 20, note: 60, length: 2, velocity: 0.8 }] })
    setTransport({ bpm: 97 })
    expect(saveStartup()).toBe(true)
    expect(hasStartup()).toBe(true)
    const s = loadStartup()!
    expect(s.patch.name).toBe("Mine")
    expect(s.patch.filter.cutoff).toBe(900)
    expect(s.pattern.steps).toBe(32)
    expect(s.bpm).toBe(97)
  })

  it("ignores missing or corrupt data", () => {
    expect(loadStartup()).toBeNull()
    localStorage.setItem("osc8.startup.v1", "{not json")
    expect(loadStartup()).toBeNull()
    localStorage.setItem("osc8.startup.v1", JSON.stringify({ version: 1, patch: { name: 3 } }))
    expect(loadStartup()).toBeNull()
  })
})
