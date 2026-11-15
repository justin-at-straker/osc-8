import * as React from "react"
import { isTextEntry } from "./keys"
import type { EngineControls } from "./types"

// The DAW-standard computer keyboard: the home row is the white keys from C,
// the row above the black keys, so A..K plays C up to the next C. Z and X
// shift the octave. Physical key codes, so it sits the same on any layout.
const SEMITONES: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12,
}
const BY_KEY: Record<string, string> = { a: "KeyA", w: "KeyW", s: "KeyS", e: "KeyE", d: "KeyD", f: "KeyF", t: "KeyT", g: "KeyG", y: "KeyY", h: "KeyH", u: "KeyU", j: "KeyJ", k: "KeyK", z: "KeyZ", x: "KeyX" }

export const MIN_OCTAVE = 0
export const MAX_OCTAVE = 8
const VELOCITY = 0.8

/** The physical key for an event: its code, or, where a test or old browser leaves code empty, its letter. */
const codeOf = (event: KeyboardEvent) => event.code || BY_KEY[event.key?.toLowerCase()] || ""

/**
 * Plays the engine from the computer keyboard. Returns the octave (C4 = 60 at
 * octave 4) so the panel can show it. Key repeats, modified keys and text
 * entry are ignored; every note held is released on blur.
 */
export function useQwertyKeyboard(engine: EngineControls, initialOctave = 4) {
  const [octave, setOctave] = React.useState(initialOctave)
  const noteOn = React.useEffectEvent((semitone: number) => {
    const note = Math.min(127, (octave + 1) * 12 + semitone)
    engine.noteOn(note, VELOCITY)
    return note
  })
  const noteOff = React.useEffectEvent((note: number) => engine.noteOff(note))

  React.useEffect(() => {
    // The note each held key started, so a release after an octave change stops the right one.
    const held = new Map<string, number>()

    const onDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTextEntry(event.target)) return
      const code = codeOf(event)
      if (code === "KeyZ" || code === "KeyX") {
        if (event.repeat) return
        setOctave((o) => Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, o + (code === "KeyX" ? 1 : -1))))
        return
      }
      const semitone = SEMITONES[code]
      if (semitone === undefined) return
      event.preventDefault()
      if (event.repeat || held.has(code)) return
      held.set(code, noteOn(semitone))
    }
    const onUp = (event: KeyboardEvent) => {
      const code = codeOf(event)
      const note = held.get(code)
      if (note === undefined) return
      held.delete(code)
      noteOff(note)
    }
    const releaseAll = () => {
      for (const note of held.values()) noteOff(note)
      held.clear()
    }

    window.addEventListener("keydown", onDown)
    window.addEventListener("keyup", onUp)
    window.addEventListener("blur", releaseAll)
    return () => {
      window.removeEventListener("keydown", onDown)
      window.removeEventListener("keyup", onUp)
      window.removeEventListener("blur", releaseAll)
      releaseAll()
    }
  }, [])

  return { octave, setOctave }
}
