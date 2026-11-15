// DRUM_VOICES order (drums.ts) without zod, for the AudioWorklet bundle.
// engine.test.ts asserts it matches drums.ts exactly.
export const DRUM_ORDER = ["kick", "snare", "clap", "rim", "closedHat", "openHat", "lowTom", "midTom", "highTom", "cowbell", "cymbal"] as const
