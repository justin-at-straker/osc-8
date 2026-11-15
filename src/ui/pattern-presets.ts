import type { Note, Pattern } from "@/engine/protocol"

const n = (step: number, note: number, length = 1, velocity = 0.75): Note => ({ step, note, length, velocity })

/** The tempo the default groove is written for. */
export const DEMO_BPM = 124

// One bar of the funk bassline, transposed to `root`: the root on the one, a
// ghost on the "a" of 1, the octave pop on 2, then a walk up the minor
// pentatonic and back down into the next bar. `end` replaces the last beat.
function funkBar(bar: number, root: number, end: [number, number, number, number]): Note[] {
  const at = bar * 16
  return [
    n(at + 0, root, 2, 0.95),
    n(at + 3, root, 1, 0.55), // ghost
    n(at + 4, root + 12, 1, 0.85), // octave pop
    n(at + 6, root, 1, 0.7),
    n(at + 7, root + 3, 1, 0.8),
    n(at + 8, root + 5, 2, 0.9),
    n(at + 10, root, 1, 0.6), // ghost
    n(at + 11, root + 3, 1, 0.75),
    n(at + 12, end[0], 1, 0.85),
    n(at + 13, end[1], 1, 0.7),
    n(at + 14, end[2], 1, 0.75),
    n(at + 15, end[3], 1, 0.7),
  ]
}

// Roots: the bass preset plays an octave down, so G3 (55) sounds as G2.
const G = 55
const C = 48
const D = 50

/**
 * An original 4-bar funky house bassline in G minor for the default BS Funk
 * Machine preset: Gm | Gm | Cm | D. Syncopated, octave-popping and full of
 * ghost notes, with a run down the octave closing bar 2 and a D turnaround
 * pulling back to G.
 */
export const DEMO_PATTERN: Pattern = {
  steps: 64,
  notes: [
    ...funkBar(0, G, [62, 60, 58, 53]), // D C Bb F
    ...funkBar(1, G, [67, 65, 62, 58]), // run down: G F D Bb
    ...funkBar(2, C, [55, 53, 51, 50]), // G F Eb D
    // Bar 4: D turnaround with the F# leading back to G.
    n(48, D, 2, 0.95), n(51, D, 1, 0.55), n(52, D + 12, 1, 0.85), n(54, D, 1, 0.7),
    n(55, 54, 1, 0.8), n(56, 57, 2, 0.9), n(58, D, 1, 0.6), n(59, 54, 1, 0.75),
    n(60, 60, 1, 0.85), n(61, 57, 1, 0.75), n(62, 54, 1, 0.8), n(63, 50, 1, 0.7),
  ],
}
