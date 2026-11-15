// Store -> engine bridge. Subscribes to the app store and forwards only what
// changed to the worklet; writes the engine's playhead back into the store.
import { useSyncExternalStore } from "react"
import { getState, setAudio, setStep, subscribe, type State } from "@/state/store"
import type { EngineClient } from "./client"
import { patchToParams } from "./params"

/**
 * Sync the engine with the store: a full param sync now, then diffs on every
 * store change. Returns a disconnect function.
 */
export function connectEngine(client: EngineClient): () => void {
  let state: State = getState()
  // Last value sent per param id.
  const sent = new Map<number, number>()

  const sendParams = (all: boolean) => {
    const changed: [number, number][] = []
    for (const [id, value] of patchToParams(state.patch)) {
      if (all || sent.get(id) !== value) {
        sent.set(id, value)
        changed.push([id, value])
      }
    }
    client.setParams(changed)
  }

  sendParams(true)
  client.setPattern(state.pattern)
  client.setTransport(state.transport.playing, state.transport.bpm)

  const unsubscribe = subscribe(() => {
    const prev = state
    state = getState()
    if (state.patch !== prev.patch) sendParams(false)
    if (state.pattern !== prev.pattern) client.setPattern(state.pattern)
    if (state.transport.playing !== prev.transport.playing || state.transport.bpm !== prev.transport.bpm) {
      client.setTransport(state.transport.playing, state.transport.bpm)
    }
  })
  const offStep = client.onStep(setStep)
  const offMod = client.onMod(setModValues)

  return () => {
    unsubscribe()
    offStep()
    offMod()
    setModValues(null)
  }
}

// ---- Modulation readback (not part of undo or the patch store) ----

let modValues: Float32Array | null = null
const modListeners = new Set<() => void>()

function setModValues(values: Float32Array | null) {
  modValues = values
  for (const l of modListeners) l()
}

/** Latest effective values of params 0..38 (indexed by param id), or null when no mod route is live. */
export function getModValues(): Float32Array | null {
  return modValues
}

export function subscribeModValues(listener: () => void): () => void {
  modListeners.add(listener)
  return () => {
    modListeners.delete(listener)
  }
}

/**
 * The current modulated value of one param (by id, see params.ts), or null when
 * no route is live. Re-renders only when that value changes (~30 Hz max).
 */
export function useModValue(id: number): number | null {
  return useSyncExternalStore(subscribeModValues, () => (modValues && id >= 0 && id < modValues.length ? modValues[id] : null))
}

const connections = new WeakMap<EngineClient, () => void>()

/**
 * Start audio from a user gesture: store audio "starting" -> client.start() ->
 * connectEngine -> "on". On failure sets "error" and resolves to null (the error
 * is logged, not thrown). Resolves to the disconnect function on success.
 * Calling it again for an already-connected client returns the same disconnect.
 */
export async function startAudio(client: EngineClient): Promise<(() => void) | null> {
  const existing = connections.get(client)
  if (existing) return existing
  setAudio("starting")
  try {
    await client.start()
    const again = connections.get(client) // a concurrent call may have won
    if (again) return again
    const disconnect = connectEngine(client)
    const dispose = () => {
      connections.delete(client)
      disconnect()
    }
    connections.set(client, dispose)
    setAudio("on")
    return dispose
  } catch (err) {
    console.error("osc8: audio failed to start", err)
    setAudio("error")
    return null
  }
}
