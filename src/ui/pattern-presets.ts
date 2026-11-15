import type { Note, Pattern } from "@/engine/protocol"

const n = (step: number, note: number, length = 1, velocity = 0.75): Note => ({ step, note, length, velocity })

/** The tempo the default groove is written for. */
export const DEMO_BPM = 122

/**
 * An original 4-bar disco-funk bassline for the default BS Funk Machine
 * preset, over Em | C#m7b5 | Cmaj7 | D. Each bar lands on the root, climbs
 * through chord tones with syncopated 16ths and ghost notes, and the D bar
 * walks D# into the E at the top of the loop. Written in the roll's range;
 * the preset's octave -1 puts it in the bass register.
 */
export const DEMO_PATTERN: Pattern = {
  steps: 64,
  notes: [
    // Em: E B E D B | E G A B
    n(0, 52, 2, 0.95), n(2, 59, 1, 0.6), n(4, 64, 1, 0.85), n(5, 62, 1, 0.7), n(7, 59, 1, 0.8),
    n(8, 52, 2, 0.9), n(11, 55, 1, 0.75), n(12, 57, 1, 0.8), n(14, 59, 2, 0.7),
    // C#m7b5: C# E G C# | B G E C#
    n(16, 49, 2, 0.95), n(19, 52, 1, 0.6), n(20, 55, 1, 0.8), n(22, 49, 1, 0.7),
    n(24, 59, 2, 0.85), n(26, 55, 1, 0.65), n(28, 52, 1, 0.8), n(29, 61, 1, 0.7), n(30, 61, 2, 0.75),
    // Cmaj7: C C E G B | C G E B G
    n(32, 48, 2, 0.95), n(35, 48, 1, 0.55), n(36, 52, 1, 0.8), n(38, 55, 1, 0.75), n(39, 59, 1, 0.8),
    n(40, 60, 2, 0.9), n(42, 55, 1, 0.65), n(43, 52, 1, 0.7), n(44, 59, 1, 0.8), n(46, 55, 2, 0.75),
    // D: D A C A F# | D A F# E D#
    n(48, 50, 2, 0.95), n(50, 57, 1, 0.7), n(52, 60, 1, 0.8), n(53, 57, 1, 0.7), n(55, 54, 1, 0.8),
    n(56, 62, 2, 0.9), n(58, 57, 1, 0.65), n(60, 54, 1, 0.8), n(61, 52, 1, 0.7), n(62, 51, 2, 0.8),
  ],
}
