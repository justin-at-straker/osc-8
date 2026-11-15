import { batch, editPatch, endGesture, setDrumPattern, setPattern, setTransport } from "@/state/store"
import type { ImportResult } from "./convert"

/**
 * Apply a converted MIDI file: the synth pattern, the 808 pattern and the osc A
 * octave as ONE undo step; the tempo too if asked (tempo isn't part of undo).
 */
export async function applyImport(result: ImportResult, { setTempo }: { setTempo: boolean }) {
  endGesture()
  await batch(async () => {
    if (result.pattern) {
      setPattern(result.pattern, "user")
      editPatch({ oscA: { octave: result.octave } }, "user")
    }
    if (result.drums) setDrumPattern(result.drums, "user")
  })
  endGesture()
  if (setTempo && result.bpm) setTransport({ bpm: result.bpm })
}
