import type { Note, Pattern } from "@/engine/protocol"

const n = (step: number, note: number, length = 1, velocity = 0.75): Note => ({ step, note, length, velocity })

/**
 * A C minor bass-and-arp line inside the roll's C3..C5 window, so pressing
 * play makes sound straight away: a held root on each beat with the arp
 * answering on the off-steps, through C, Eb, Ab and Bb.
 */
export const DEMO_PATTERN: Pattern = {
  steps: 16,
  notes: [
    n(0, 48, 2, 0.95), n(2, 60), n(3, 55, 1, 0.6),
    n(4, 51, 2, 0.9), n(6, 63), n(7, 55, 1, 0.6),
    n(8, 56, 2, 0.9), n(10, 68), n(11, 63, 1, 0.6),
    n(12, 58, 2, 0.9), n(14, 70), n(15, 67, 1, 0.6),
  ],
}
