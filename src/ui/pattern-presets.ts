import type { Note, Pattern } from "@/engine/protocol"

const n = (step: number, note: number, length = 1, velocity = 0.75): Note => ({ step, note, length, velocity })

/** The tempo the default melody is written for (16ths at ~144 ms). */
export const DEMO_BPM = 104

/**
 * The opening of Beethoven's "Für Elise" (public domain), one octave down so
 * it sits inside the roll's C3..C5 window: the E/D# turn, the run down to A,
 * then the C-E-A pickup to B. Loops as one bar of 16ths.
 */
export const DEMO_PATTERN: Pattern = {
  steps: 16,
  notes: [
    n(0, 64, 1, 0.8), n(1, 63, 1, 0.6), n(2, 64, 1, 0.75), n(3, 63, 1, 0.6),
    n(4, 64, 1, 0.75), n(5, 59, 1, 0.65), n(6, 62, 1, 0.7), n(7, 60, 1, 0.7),
    n(8, 57, 3, 0.9),
    n(11, 48, 1, 0.55), n(12, 52, 1, 0.6), n(13, 57, 1, 0.7),
    n(14, 59, 2, 0.85),
  ],
}
