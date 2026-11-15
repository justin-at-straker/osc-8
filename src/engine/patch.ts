// The patch schema: the one contract shared by knobs, AI tools, presets and the
// engine. The full v1 shape is defined here even where M1 doesn't wire it yet.
// Every numeric field is in engineering units (Hz, seconds, semitones, 0..1).
import { z } from "zod"

export const PATCH_VERSION = 1

const unit = z.number().min(0).max(1)
const bipolar = z.number().min(-1).max(1)

export const WARP_MODES = ["off", "sync", "bend", "pwm", "fm", "mirror"] as const
export const FILTER_TYPES = ["lp12", "lp24", "hp12", "hp24", "bp12", "bp24", "notch", "comb"] as const
export const LFO_SHAPES = ["sine", "triangle", "saw", "square", "random"] as const
export const MOD_SOURCES = [
  "none", "env1", "env2", "env3", "lfo1", "lfo2", "lfo3", "lfo4",
  "velocity", "modwheel", "note", "random",
] as const
export const DIST_TYPES = ["tube", "soft", "hard", "fold", "bitcrush"] as const

/** A wavetable reference: a built-in table, an imported sample, or a formula/spectrum table. */
export const WavetableRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("builtin"), name: z.string() }),
  z.object({ kind: z.literal("sample"), id: z.string() }),
  z.object({
    kind: z.literal("spectrum"),
    /** Frames morphed across by `position`. Each frame is harmonic amplitudes, index 0 = fundamental. */
    frames: z.array(z.array(z.number().min(0).max(1)).min(1).max(256)).min(1).max(64),
    label: z.string().optional(),
  }),
])
export type WavetableRef = z.infer<typeof WavetableRef>

export const Oscillator = z.object({
  enabled: z.boolean(),
  table: WavetableRef,
  position: unit,
  level: unit,
  pan: bipolar,
  octave: z.number().int().min(-4).max(4),
  semi: z.number().int().min(-12).max(12),
  fine: z.number().min(-100).max(100), // cents
  unison: z.number().int().min(1).max(16),
  detune: unit,
  blend: unit,
  spread: unit,
  phase: unit,
  randomPhase: unit,
  warp: z.enum(WARP_MODES),
  warpAmount: unit,
  toFilter: z.boolean(),
})

export const Envelope = z.object({
  attack: z.number().min(0).max(20), // seconds
  decay: z.number().min(0).max(20),
  sustain: unit,
  release: z.number().min(0).max(20),
})

export const Lfo = z.object({
  shape: z.enum(LFO_SHAPES),
  rate: z.number().min(0.01).max(50), // Hz when free, ignored when synced
  sync: z.boolean(),
  syncDivision: z.enum(["1/1", "1/2", "1/4", "1/8", "1/16", "1/4t", "1/8t", "1/8d"]),
  oneShot: z.boolean(),
})

export const ModRoute = z.object({
  source: z.enum(MOD_SOURCES),
  /** A ParamId from params.ts, e.g. "filter.cutoff". */
  target: z.string(),
  amount: bipolar,
  aux: z.enum(MOD_SOURCES),
})

export const Patch = z.object({
  version: z.literal(PATCH_VERSION),
  id: z.string(),
  name: z.string().max(64),
  oscA: Oscillator,
  oscB: Oscillator,
  sub: z.object({ enabled: z.boolean(), level: unit, octave: z.number().int().min(-2).max(0), shape: z.enum(["sine", "triangle", "square"]) }),
  noise: z.object({ enabled: z.boolean(), level: unit, color: unit, toFilter: z.boolean() }),
  filter: z.object({
    enabled: z.boolean(),
    type: z.enum(FILTER_TYPES),
    cutoff: z.number().min(20).max(20000), // Hz
    resonance: unit,
    drive: unit,
    mix: unit,
    keytrack: unit,
  }),
  env1: Envelope, // amp envelope
  env2: Envelope,
  env3: Envelope,
  lfos: z.array(Lfo).length(4),
  mod: z.array(ModRoute).max(16),
  fx: z.object({
    distortion: z.object({ enabled: z.boolean(), type: z.enum(DIST_TYPES), drive: unit, mix: unit }),
    chorus: z.object({ enabled: z.boolean(), rate: z.number().min(0.01).max(10), depth: unit, mix: unit }),
    delay: z.object({ enabled: z.boolean(), time: z.enum(["1/4", "1/8", "1/8d", "1/16", "1/4t"]), feedback: unit, mix: unit, pingPong: z.boolean() }),
    reverb: z.object({ enabled: z.boolean(), size: unit, decay: unit, damping: unit, mix: unit }),
    ott: z.object({ enabled: z.boolean(), depth: unit, time: unit }),
    eq: z.object({ enabled: z.boolean(), low: z.number().min(-12).max(12), mid: z.number().min(-12).max(12), high: z.number().min(-12).max(12) }),
  }),
  voicing: z.object({
    mode: z.enum(["poly", "mono"]),
    voices: z.number().int().min(1).max(16),
    legato: z.boolean(),
    glide: z.number().min(0).max(2), // seconds
  }),
  master: z.object({ volume: unit }),
})
export type Patch = z.infer<typeof Patch>

/** A deep-partial patch, for AI `setPatch` edits merged onto the current patch. */
export type PatchEdit = { [K in keyof Patch]?: Patch[K] extends object ? Partial<Patch[K]> : Patch[K] }

const osc = (enabled: boolean, name: string): z.infer<typeof Oscillator> => ({
  enabled, table: { kind: "builtin", name }, position: 0, level: 0.75, pan: 0,
  octave: 0, semi: 0, fine: 0, unison: 1, detune: 0.25, blend: 0.75, spread: 0.5,
  phase: 0, randomPhase: 1, warp: "off", warpAmount: 0, toFilter: true,
})
const env = (attack: number, decay: number, sustain: number, release: number) => ({ attack, decay, sustain, release })
const lfo = (): z.infer<typeof Lfo> => ({ shape: "sine", rate: 1, sync: true, syncDivision: "1/4", oneShot: false })

export function defaultPatch(id = "init"): Patch {
  return {
    version: PATCH_VERSION, id, name: "Init",
    oscA: osc(true, "basic"), oscB: osc(false, "basic"),
    sub: { enabled: false, level: 0.5, octave: -1, shape: "sine" },
    noise: { enabled: false, level: 0.25, color: 0.5, toFilter: true },
    filter: { enabled: true, type: "lp24", cutoff: 4000, resonance: 0.2, drive: 0, mix: 1, keytrack: 0 },
    env1: env(0.005, 0.3, 0.7, 0.25), env2: env(0.01, 0.4, 0, 0.3), env3: env(0.01, 0.4, 0, 0.3),
    lfos: [lfo(), lfo(), lfo(), lfo()],
    mod: [],
    fx: {
      distortion: { enabled: false, type: "tube", drive: 0.3, mix: 1 },
      chorus: { enabled: false, rate: 0.8, depth: 0.4, mix: 0.4 },
      delay: { enabled: false, time: "1/8d", feedback: 0.35, mix: 0.25, pingPong: true },
      reverb: { enabled: false, size: 0.6, decay: 0.5, damping: 0.5, mix: 0.25 },
      ott: { enabled: false, depth: 0.5, time: 0.5 },
      eq: { enabled: false, low: 0, mid: 0, high: 0 },
    },
    voicing: { mode: "poly", voices: 8, legato: false, glide: 0 },
    master: { volume: 0.7 },
  }
}

/** Built-in wavetable names the engine generates. Position morphs across each table's frames. */
export const BUILTIN_TABLES = ["basic", "pwm", "harmonic-sweep", "formant", "digital"] as const
