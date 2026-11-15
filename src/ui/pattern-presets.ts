import type { Note, Pattern } from "@/engine/protocol"

const n = (step: number, note: number, length = 1, velocity = 0.75): Note => ({ step, note, length, velocity })
const chord = (step: number, notes: number[], length: number, velocity: number) => notes.map((note) => n(step, note, length, velocity))

/** The tempo the default hook is written for. */
export const DEMO_BPM = 118

/**
 * An original 80s synth-pop hook for the default KY 80s Poly Brass preset:
 * syncopated brass stabs in D minor moving Dm - Bb - C - A, with a held
 * chord at the end of the bar for the chorus and reverb to bloom.
 */
export const DEMO_PATTERN: Pattern = {
  steps: 16,
  notes: [
    ...chord(0, [62, 65, 69], 2, 0.95), // Dm
    ...chord(3, [62, 65, 69], 1, 0.7),
    ...chord(6, [58, 62, 65], 2, 0.85), // Bb
    ...chord(10, [60, 64, 67], 2, 0.9), // C
    ...chord(12, [57, 61, 64], 4, 0.8), // A, held into the loop
  ],
}
