// "Save as startup default": the whole session (sound, notes, drums, tempo)
// stored in this browser and restored when OSC-8 opens. Local only, like keys.
import { Patch } from "@/engine/patch"
import { DrumKit, type DrumPattern } from "@/engine/drums"
import type { Pattern } from "@/engine/protocol"
import { getState } from "./store"

const KEY = "osc8.startup.v1"

export type StartupState = {
  version: 1
  patch: Patch
  pattern: Pattern
  drums: { kit: DrumKit; pattern: DrumPattern }
  bpm: number
}

export function captureStartup(): StartupState {
  const s = getState()
  return { version: 1, patch: s.patch, pattern: s.pattern, drums: s.drums, bpm: s.transport.bpm }
}

/** Save the current session as what OSC-8 opens with. Returns false if storage is unavailable. */
export function saveStartup(): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(captureStartup()))
    return true
  } catch {
    return false
  }
}

export function clearStartup() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing saved, or storage is blocked: either way there's no custom default.
  }
}

export function hasStartup(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}

const isPattern = (p: unknown): p is Pattern =>
  !!p && typeof p === "object" && typeof (p as Pattern).steps === "number" && Array.isArray((p as Pattern).notes)
const isDrumPattern = (p: unknown): p is DrumPattern =>
  !!p && typeof p === "object" && typeof (p as DrumPattern).steps === "number" && Array.isArray((p as DrumPattern).hits)

/** Download the current session as a `.osc8-session.json` file (sound, patterns, kit, tempo). */
export function exportSession(name = "session") {
  const blob = new Blob([JSON.stringify(captureStartup(), null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.osc8-session.json` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The saved session, validated, or null if there is none or it no longer fits the schema. */
export function loadStartup(): StartupState | null {
  try {
    return parseSession(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

/** Validate session data (a JSON string or an already-parsed object); null if it doesn't fit the schema. */
export function parseSession(input: string | unknown | null): StartupState | null {
  try {
    if (input === null || input === undefined) return null
    const data = (typeof input === "string" ? JSON.parse(input) : input) as Partial<StartupState>
    const patch = Patch.safeParse(data.patch)
    const kit = DrumKit.safeParse(data.drums?.kit)
    if (!patch.success || !kit.success || !isPattern(data.pattern) || !isDrumPattern(data.drums?.pattern)) return null
    const bpm = typeof data.bpm === "number" && data.bpm >= 60 && data.bpm <= 200 ? data.bpm : 120
    return { version: 1, patch: patch.data, pattern: data.pattern, drums: { kit: kit.data, pattern: data.drums.pattern }, bpm }
  } catch {
    return null
  }
}
