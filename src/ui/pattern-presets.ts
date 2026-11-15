import type { Note, Pattern } from "@/engine/protocol"

const n = (step: number, note: number, length = 1, velocity = 0.75): Note => ({ step, note, length, velocity })
const chord = (step: number, notes: number[], length: number, velocity: number) => notes.map((note) => n(step, note, length, velocity))

/** The tempo the default hook is written for. */
export const DEMO_BPM = 118

// One bar of the hook: brass stabs on the chord (steps 0, 3, 6), then a
// three-note top line answering on 10, 12, 14.
function bar(index: number, triad: number[], answer: [number, number, number]): Note[] {
  const at = index * 16
  return [
    ...chord(at, triad, 2, 0.95),
    ...chord(at + 3, triad, 1, 0.7),
    ...chord(at + 6, triad, 2, 0.85),
    n(at + 10, answer[0], 2, 0.85),
    n(at + 12, answer[1], 2, 0.75),
    n(at + 14, answer[2], 2, 0.8),
  ]
}

const Dm = [62, 65, 69]
const Bb = [58, 62, 65]
const C = [60, 64, 67]
const A = [57, 61, 64]
const Gm = [55, 58, 62]

/**
 * An original 8-bar 80s synth-pop hook in D minor for the default KY 80s Poly
 * Brass preset: Dm | Bb | C | A | Dm | Bb | Gm | A. Each bar answers its
 * stabs with a short top line; the last bar holds the A chord under a
 * rising line (A7) so the loop resolves back to Dm.
 */
export const DEMO_PATTERN: Pattern = {
  steps: 128,
  notes: [
    ...bar(0, Dm, [69, 67, 65]),
    ...bar(1, Bb, [65, 67, 69]),
    ...bar(2, C, [72, 70, 69]),
    ...bar(3, A, [64, 67, 69]),
    ...bar(4, Dm, [69, 67, 65]),
    ...bar(5, Bb, [65, 67, 70]),
    ...bar(6, Gm, [70, 69, 67]),
    // Bar 8: the A chord held under a rising E - G - A line (A7), pulling back to Dm.
    ...chord(112, A, 16, 0.85),
    n(116, 64, 4, 0.7), n(120, 67, 4, 0.8), n(124, 69, 4, 0.85),
  ],
}
