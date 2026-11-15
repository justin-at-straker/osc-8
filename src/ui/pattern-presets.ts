import type { Note, Pattern } from "@/engine/protocol"

const n = (step: number, note: number, length = 1, velocity = 0.75): Note => ({ step, note, length, velocity })

/** The tempo the default riff is written for. */
export const DEMO_BPM = 128

/**
 * An original trance-style supersaw riff in A minor, written for the default
 * LD Super Saw preset: a held A that falls through E and G, lifts to C,
 * then turns back down B-G-E into the loop. The rests and held notes leave
 * room for the dotted-eighth delay to answer.
 */
export const DEMO_PATTERN: Pattern = {
  steps: 16,
  notes: [
    n(0, 69, 2, 0.95), n(2, 64, 1, 0.7), n(3, 69, 1, 0.8),
    n(4, 67, 2, 0.9), n(6, 64, 1, 0.7),
    n(7, 60, 2, 0.85), n(9, 64, 1, 0.7),
    n(10, 72, 2, 0.95), n(12, 71, 1, 0.8), n(13, 67, 1, 0.75),
    n(14, 64, 2, 0.85),
  ],
}
