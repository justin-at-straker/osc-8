import type { Note, Pattern } from "@/engine/protocol"

const n = (step: number, note: number, length = 1, velocity = 0.75): Note => ({ step, note, length, velocity })

/** The tempo the default groove is written for. */
export const DEMO_BPM = 122

/**
 * The default 4-bar disco-funk bassline for the BS Funk Machine preset, over
 * Em | C#m7b5 | Cmaj7 | D11, transcribed from the tab. Each chord's root is
 * pushed: it lands on the last 8th of the bar before and ties over. Written
 * two octaves up in the roll's range (E3 here is the bass's E1); the preset's
 * octave -1 and sub drop it back into the bass register.
 */
export const DEMO_PATTERN: Pattern = {
  steps: 64,
  notes: [
    // Em: E1 E2 | E2 G2 | E1 E1 E2 E2 | A2, pushed C#1
    n(0, 52, 2, 0.95), n(2, 64, 1, 0.7), n(4, 64, 2, 0.85), n(6, 67, 1, 0.75),
    n(8, 52, 1, 0.9), n(9, 52, 1, 0.6), n(10, 64, 1, 0.8), n(11, 64, 1, 0.65),
    n(13, 69, 1, 0.75), n(14, 49, 4, 0.95),
    // C#m7b5: C#2 | G1 | A1 D1 | C#1, pushed C1 - chromatic walk down to C
    n(18, 61, 2, 0.8), n(22, 55, 2, 0.8), n(25, 57, 1, 0.75), n(26, 50, 1, 0.8),
    n(28, 49, 1, 0.8), n(30, 48, 4, 0.95),
    // Cmaj7: C2 C3 | G2 | G1 E2 | pushed D1
    n(34, 60, 1, 0.75), n(35, 72, 1, 0.8), n(37, 67, 2, 0.8),
    n(40, 55, 2, 0.85), n(43, 64, 1, 0.75), n(46, 50, 4, 0.95),
    // D11: A2 | D2 B2 A1 | D#2 D#1 | pushed E1 back to the top
    n(50, 69, 1, 0.75), n(52, 62, 2, 0.85), n(54, 71, 1, 0.8), n(55, 57, 1, 0.7),
    n(57, 63, 1, 0.75), n(59, 51, 1, 0.8), n(62, 52, 2, 0.95),
  ],
}
