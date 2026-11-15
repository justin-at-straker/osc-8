// The factory bank. Each preset is defaultPatch() plus an edit, so presets
// stay valid as the schema grows. Only what the engine renders is set: osc A,
// the low-pass filter, the envelopes, LFOs + mod matrix, FX and master volume.
import { defaultPatch, Patch } from "@/engine/patch"
import type { DeepPartial } from "@/state/store"

export const PRESET_CATEGORIES = {
  BS: "Bass",
  LD: "Lead",
  PD: "Pad",
  PL: "Pluck",
  KY: "Keys",
  FX: "Effects",
} as const
export type PresetCategory = keyof typeof PRESET_CATEGORIES

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

function merge<T>(base: T, edit: unknown): T {
  if (!isObject(base) || !isObject(edit)) return (edit === undefined ? base : edit) as T
  const out: Record<string, unknown> = { ...base }
  // A wavetable ref is replaced whole, as the store does.
  for (const [k, v] of Object.entries(edit)) out[k] = k === "table" ? v : merge((base as Record<string, unknown>)[k], v)
  return out as T
}

function preset(slug: string, name: string, edit: DeepPartial<Patch>): Patch {
  return Patch.parse(merge(defaultPatch(`factory/${slug}`), { ...edit, name }))
}

const table = (name: string) => ({ kind: "builtin" as const, name })

// Modulation helpers: LFO and route literals with the schema's defaults filled in.
type LfoEdit = Partial<Patch["lfos"][number]>
const lfo = (o: LfoEdit = {}): Patch["lfos"][number] => ({ shape: "sine", rate: 1, sync: true, syncDivision: "1/4", oneShot: false, ...o })
const lfos = (...set: LfoEdit[]) => [0, 1, 2, 3].map((i) => lfo(set[i]))
type Src = Patch["mod"][number]["source"]
const route = (source: Src, target: string, amount: number, aux: Src = "none") => ({ source, target, amount, aux })

/**
 * The factory bank: every preset moves (LFOs, envelopes or sample & hold
 * through the mod matrix) and is finished with the FX chain. Names carry a
 * category prefix (BS, LD, PD, PL, KY, FX) that groups them in the browser.
 */
export const FACTORY_PRESETS: Patch[] = [
  // ---- Bass ----
  preset("wub-machine", "BS Wub Machine", {
    oscA: { table: table("basic"), position: 0.72, octave: -2, level: 0.85, unison: 5, detune: 0.15, blend: 0.6, spread: 0.5 },
    oscB: { enabled: true, table: table("digital"), position: 0.4, octave: -2, level: 0.35, unison: 3, detune: 0.12, spread: 0.4 },
    sub: { enabled: true, level: 0.5, octave: -1, shape: "sine" },
    filter: { cutoff: 420, resonance: 0.55 },
    env1: { attack: 0.003, decay: 0.3, sustain: 1, release: 0.08 },
    lfos: lfos({ shape: "triangle", syncDivision: "1/8" }, { shape: "sine", syncDivision: "1/8" }),
    mod: [route("lfo1", "filter.cutoff", 0.42), route("lfo2", "oscA.position", 0.15)],
    fx: {
      distortion: { enabled: true, type: "tube", drive: 0.5, mix: 0.7 },
      ott: { enabled: true, depth: 0.6, time: 0.4 },
      eq: { enabled: true, low: 2, mid: 0, high: -2 },
    },
    master: { volume: 0.7 },
  }),
  preset("reese-drift", "BS Reese Drift", {
    oscA: { table: table("pwm"), position: 0.62, octave: -2, fine: -9, level: 0.8, unison: 7, detune: 0.35, blend: 0.8, spread: 0.8 },
    oscB: { enabled: true, table: table("pwm"), position: 0.4, octave: -2, fine: 9, level: 0.6, unison: 3, detune: 0.2, blend: 0.7, spread: 0.6 },
    sub: { enabled: true, level: 0.55, octave: -1, shape: "sine" },
    filter: { cutoff: 380, resonance: 0.3 },
    env1: { attack: 0.004, decay: 0.4, sustain: 0.95, release: 0.14 },
    lfos: lfos({ sync: false, rate: 0.15 }, { sync: false, rate: 0.31, shape: "triangle" }),
    mod: [route("lfo1", "oscA.position", 0.2), route("lfo2", "filter.cutoff", 0.08)],
    fx: {
      distortion: { enabled: true, type: "tube", drive: 0.35, mix: 0.6 },
      chorus: { enabled: true, rate: 0.22, depth: 0.9, mix: 0.6 },
      ott: { enabled: true, depth: 0.4, time: 0.5 },
    },
    master: { volume: 0.72 },
  }),
  preset("sub-punch", "BS 808 Punch", {
    oscA: { table: table("basic"), position: 0.05, octave: -2, level: 0.9 },
    filter: { cutoff: 320, resonance: 0.05 },
    env1: { attack: 0.001, decay: 0.9, sustain: 0.35, release: 0.25 },
    env2: { attack: 0, decay: 0.07, sustain: 0, release: 0.05 },
    mod: [route("env2", "oscA.semi", 0.25), route("velocity", "filter.cutoff", 0.15)],
    fx: {
      distortion: { enabled: true, type: "soft", drive: 0.35, mix: 0.5 },
      eq: { enabled: true, low: 3, mid: -1, high: -3 },
    },
    master: { volume: 0.8 },
  }),
  preset("growl-formant", "BS Growl Formant", {
    oscA: { table: table("formant"), position: 0.3, octave: -2, level: 0.8, unison: 3, detune: 0.12, spread: 0.4 },
    oscB: { enabled: true, table: table("digital"), position: 0.5, octave: -2, level: 0.45 },
    sub: { enabled: true, level: 0.5, octave: -1, shape: "sine" },
    filter: { cutoff: 1200, resonance: 0.45 },
    env1: { attack: 0.003, decay: 0.3, sustain: 0.9, release: 0.1 },
    lfos: lfos({ syncDivision: "1/16" }, { shape: "random", syncDivision: "1/8" }),
    mod: [route("lfo1", "oscA.position", 0.35), route("lfo2", "filter.cutoff", 0.2)],
    fx: {
      distortion: { enabled: true, type: "fold", drive: 0.55, mix: 0.75 },
      ott: { enabled: true, depth: 0.7, time: 0.3 },
      eq: { enabled: true, low: 2, mid: 2, high: -3 },
    },
    master: { volume: 0.68 },
  }),

  // ---- Lead ----
  preset("vox-talker", "LD Vox Talker", {
    oscA: { table: table("formant"), position: 0.5, level: 0.8, unison: 3, detune: 0.08, spread: 0.3 },
    filter: { cutoff: 3200, resonance: 0.25 },
    env1: { attack: 0.01, decay: 0.3, sustain: 0.85, release: 0.25 },
    lfos: lfos({ shape: "triangle", syncDivision: "1/4" }, { sync: false, rate: 5.5 }),
    mod: [route("lfo1", "oscA.position", 0.45), route("lfo2", "oscA.fine", 0.06)],
    fx: {
      chorus: { enabled: true, rate: 0.5, depth: 0.4, mix: 0.3 },
      delay: { enabled: true, time: "1/8d", feedback: 0.3, mix: 0.2, pingPong: true },
      reverb: { enabled: true, size: 0.55, decay: 0.45, damping: 0.5, mix: 0.2 },
    },
    master: { volume: 0.68 },
  }),
  preset("laser-zap", "LD Laser Zap", {
    oscA: { table: table("digital"), position: 0.6, level: 0.75 },
    filter: { cutoff: 6000, resonance: 0.2 },
    env1: { attack: 0.001, decay: 0.25, sustain: 0.4, release: 0.15 },
    env2: { attack: 0, decay: 0.12, sustain: 0, release: 0.1 },
    mod: [route("env2", "oscA.semi", 0.45), route("env2", "oscA.position", -0.3)],
    fx: {
      distortion: { enabled: true, type: "hard", drive: 0.4, mix: 0.6 },
      delay: { enabled: true, time: "1/16", feedback: 0.4, mix: 0.22, pingPong: true },
      reverb: { enabled: true, size: 0.4, decay: 0.35, damping: 0.4, mix: 0.15 },
    },
    master: { volume: 0.62 },
  }),
  preset("crushed-hold", "LD Crushed S&H", {
    oscA: { table: table("digital"), position: 0.3, level: 0.75 },
    noise: { enabled: true, level: 0.15, color: 0.7, toFilter: true },
    filter: { cutoff: 2400, resonance: 0.5 },
    env1: { attack: 0.002, decay: 0.2, sustain: 0.8, release: 0.12 },
    lfos: lfos({ shape: "random", syncDivision: "1/16" }),
    mod: [route("lfo1", "filter.cutoff", 0.3), route("lfo1", "oscA.position", 0.2)],
    fx: {
      distortion: { enabled: true, type: "bitcrush", drive: 0.5, mix: 0.7 },
      delay: { enabled: true, time: "1/8", feedback: 0.3, mix: 0.2, pingPong: false },
    },
    master: { volume: 0.62 },
  }),

  // ---- Pad ----
  preset("halo-drift", "PD Halo Drift", {
    oscA: { table: table("basic"), position: 0.45, level: 0.7, unison: 7, detune: 0.25, blend: 0.7, spread: 1 },
    oscB: { enabled: true, table: table("basic"), position: 0.2, octave: 1, level: 0.4, unison: 5, detune: 0.2, blend: 0.7, spread: 1 },
    noise: { enabled: true, level: 0.08, color: 0.3, toFilter: true },
    filter: { cutoff: 1800, resonance: 0.15 },
    env1: { attack: 1.2, decay: 1, sustain: 0.8, release: 3 },
    lfos: lfos({ sync: false, rate: 0.08 }, { sync: false, rate: 0.13, shape: "triangle" }),
    mod: [route("lfo1", "oscA.position", 0.35), route("lfo2", "filter.cutoff", 0.15)],
    fx: {
      chorus: { enabled: true, rate: 0.3, depth: 0.9, mix: 0.5 },
      reverb: { enabled: true, size: 0.9, decay: 0.8, damping: 0.45, mix: 0.45 },
    },
    master: { volume: 0.7 },
  }),
  preset("glass-choir", "PD Glass Choir", {
    oscA: { table: table("formant"), position: 0.65, level: 0.7, unison: 5, detune: 0.18, spread: 0.9 },
    oscB: { enabled: true, table: table("formant"), position: 0.4, semi: 7, level: 0.35, unison: 3, detune: 0.15, spread: 0.8 },
    filter: { cutoff: 2600, resonance: 0.2 },
    env1: { attack: 0.8, decay: 1, sustain: 0.85, release: 2.5 },
    lfos: lfos({ sync: false, rate: 0.1 }, { sync: false, rate: 4.8 }),
    mod: [route("lfo1", "oscA.position", 0.3), route("lfo2", "oscA.fine", 0.04)],
    fx: {
      chorus: { enabled: true, rate: 0.4, depth: 0.7, mix: 0.45 },
      reverb: { enabled: true, size: 0.85, decay: 0.75, damping: 0.3, mix: 0.5 },
      eq: { enabled: true, low: -3, mid: 0, high: 2 },
    },
    master: { volume: 0.68 },
  }),

  // ---- Pluck ----
  preset("glass-pluck", "PL Glass Pluck", {
    oscA: { table: table("harmonic-sweep"), position: 0.45, level: 0.8, unison: 3, detune: 0.1, spread: 0.6 },
    noise: { enabled: true, level: 0.1, color: 0.8, toFilter: true },
    filter: { cutoff: 1500, resonance: 0.3 },
    env1: { attack: 0.002, decay: 0.45, sustain: 0.15, release: 0.3 },
    env2: { attack: 0, decay: 0.25, sustain: 0, release: 0.2 },
    mod: [route("env2", "filter.cutoff", 0.45), route("velocity", "oscA.position", 0.2)],
    fx: {
      delay: { enabled: true, time: "1/8d", feedback: 0.35, mix: 0.25, pingPong: true },
      reverb: { enabled: true, size: 0.6, decay: 0.5, damping: 0.4, mix: 0.25 },
    },
    master: { volume: 0.72 },
  }),
  preset("sh-bleeps", "PL S&H Bleeps", {
    oscA: { table: table("pwm"), position: 0.5, level: 0.8 },
    filter: { cutoff: 900, resonance: 0.6 },
    env1: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
    lfos: lfos({ shape: "random", syncDivision: "1/16" }),
    mod: [route("lfo1", "filter.cutoff", 0.4)],
    fx: {
      delay: { enabled: true, time: "1/8d", feedback: 0.45, mix: 0.3, pingPong: true },
      reverb: { enabled: true, size: 0.5, decay: 0.4, damping: 0.5, mix: 0.18 },
    },
    master: { volume: 0.72 },
  }),
  preset("bell-tine", "PL Bell Tine", {
    oscA: { table: table("harmonic-sweep"), position: 0.8, octave: 1, level: 0.7 },
    oscB: { enabled: true, table: table("basic"), position: 0, octave: 2, semi: 7, level: 0.35 },
    filter: { cutoff: 7000, resonance: 0.1 },
    env1: { attack: 0.001, decay: 0.9, sustain: 0, release: 1 },
    env2: { attack: 0, decay: 0.3, sustain: 0, release: 0.3 },
    mod: [route("env2", "oscA.position", -0.4)],
    fx: {
      chorus: { enabled: true, rate: 0.6, depth: 0.3, mix: 0.25 },
      reverb: { enabled: true, size: 0.7, decay: 0.6, damping: 0.3, mix: 0.35 },
    },
    master: { volume: 0.65 },
  }),

  // ---- Keys ----
  preset("dusty-rhodes", "KY Dusty Rhodes", {
    oscA: { table: table("basic"), position: 0.22, level: 0.85, unison: 2, detune: 0.05, spread: 0.4 },
    oscB: { enabled: true, table: table("basic"), position: 0, octave: 1, level: 0.25 },
    filter: { cutoff: 2200, resonance: 0.12 },
    env1: { attack: 0.004, decay: 1.2, sustain: 0.3, release: 0.5 },
    env2: { attack: 0, decay: 0.4, sustain: 0.1, release: 0.3 },
    lfos: lfos({ sync: false, rate: 4.5 }, { sync: false, rate: 0.25, shape: "triangle" }),
    mod: [route("lfo1", "oscA.fine", 0.04), route("env2", "filter.cutoff", 0.2), route("velocity", "filter.cutoff", 0.15)],
    fx: {
      distortion: { enabled: true, type: "bitcrush", drive: 0.15, mix: 0.25 },
      chorus: { enabled: true, rate: 0.7, depth: 0.45, mix: 0.35 },
      reverb: { enabled: true, size: 0.55, decay: 0.45, damping: 0.6, mix: 0.22 },
      eq: { enabled: true, low: 2, mid: 0, high: -4 },
    },
    master: { volume: 0.75 },
  }),
  preset("organ-pulse", "KY Organ Pulse", {
    oscA: { table: table("pwm"), position: 0.3, level: 0.8 },
    oscB: { enabled: true, table: table("pwm"), position: 0.5, octave: 1, level: 0.4 },
    sub: { enabled: true, level: 0.35, octave: -1, shape: "square" },
    filter: { cutoff: 3000, resonance: 0.1 },
    env1: { attack: 0.01, decay: 0.2, sustain: 1, release: 0.1 },
    lfos: lfos({ sync: false, rate: 6 }),
    mod: [route("lfo1", "oscA.level", -0.2)],
    fx: {
      chorus: { enabled: true, rate: 5.5, depth: 0.5, mix: 0.45 },
      reverb: { enabled: true, size: 0.5, decay: 0.4, damping: 0.5, mix: 0.2 },
    },
    master: { volume: 0.7 },
  }),

  // ---- Effects ----
  preset("riser-sweep", "FX Riser Sweep", {
    oscA: { table: table("digital"), position: 0.2, level: 0.7, unison: 9, detune: 0.4, spread: 1 },
    noise: { enabled: true, level: 0.35, color: 0.7, toFilter: true },
    filter: { cutoff: 400, resonance: 0.4 },
    env1: { attack: 2, decay: 1, sustain: 1, release: 2 },
    env2: { attack: 4, decay: 1, sustain: 1, release: 1 },
    lfos: lfos({ syncDivision: "1/16" }),
    mod: [route("env2", "oscA.semi", 0.5), route("env2", "filter.cutoff", 0.6), route("lfo1", "oscA.position", 0.15, "env2")],
    fx: {
      delay: { enabled: true, time: "1/8", feedback: 0.5, mix: 0.3, pingPong: true },
      reverb: { enabled: true, size: 0.85, decay: 0.7, damping: 0.4, mix: 0.4 },
    },
    master: { volume: 0.62 },
  }),
  preset("metal-drone", "FX Metal Drone", {
    oscA: { table: table("digital"), position: 0.8, octave: -1, level: 0.75 },
    oscB: { enabled: true, table: table("digital"), position: 0.3, semi: 7, level: 0.5, unison: 4, detune: 0.2, spread: 0.7 },
    noise: { enabled: true, level: 0.1, color: 0.5, toFilter: true },
    filter: { cutoff: 2000, resonance: 0.5 },
    env1: { attack: 1.5, decay: 1, sustain: 1, release: 4 },
    lfos: lfos({ sync: false, rate: 0.05 }, { shape: "random", sync: false, rate: 0.5 }),
    mod: [route("lfo1", "oscA.position", 0.5), route("lfo2", "filter.cutoff", 0.3), route("lfo1", "fx.reverb.mix", 0.2)],
    fx: {
      distortion: { enabled: true, type: "fold", drive: 0.4, mix: 0.5 },
      reverb: { enabled: true, size: 1, decay: 0.9, damping: 0.3, mix: 0.4 },
    },
    master: { volume: 0.6 },
  }),
  // ---- 80s ----
  preset("poly-brass", "KY 80s Poly Brass", {
    oscA: { table: table("pwm"), position: 0.45, level: 0.75, unison: 3, detune: 0.12, blend: 0.7, spread: 0.7 },
    oscB: { enabled: true, table: table("basic"), position: 0.66, fine: 7, level: 0.5, unison: 2, detune: 0.08, spread: 0.6 },
    sub: { enabled: true, level: 0.2, octave: -1, shape: "square" },
    filter: { cutoff: 1300, resonance: 0.2 },
    env1: { attack: 0.012, decay: 0.6, sustain: 0.7, release: 0.35 },
    env2: { attack: 0.03, decay: 0.35, sustain: 0.3, release: 0.3 },
    lfos: lfos({ sync: false, rate: 5.2 }),
    mod: [route("env2", "filter.cutoff", 0.38), route("velocity", "filter.cutoff", 0.12), route("lfo1", "oscA.fine", 0.025)],
    fx: {
      chorus: { enabled: true, rate: 0.5, depth: 0.6, mix: 0.45 },
      delay: { enabled: true, time: "1/4", feedback: 0.25, mix: 0.12, pingPong: true },
      reverb: { enabled: true, size: 0.75, decay: 0.55, damping: 0.5, mix: 0.28 },
      eq: { enabled: true, low: -1, mid: 1.5, high: 1 },
    },
    master: { volume: 0.62 },
  }),
  // ---- Showcase: big unison stacks ----
  preset("super-saw", "LD Super Saw", {
    oscA: { table: table("basic"), position: 0.66, level: 0.75, unison: 9, detune: 0.3, blend: 0.85, spread: 1 },
    oscB: { enabled: true, table: table("basic"), position: 0.66, octave: 1, level: 0.4, unison: 7, detune: 0.25, blend: 0.8, spread: 1 },
    sub: { enabled: true, level: 0.3, octave: -1, shape: "sine" },
    filter: { cutoff: 6500, resonance: 0.15 },
    env1: { attack: 0.005, decay: 0.4, sustain: 0.85, release: 0.3 },
    env2: { attack: 0, decay: 0.35, sustain: 0.4, release: 0.3 },
    mod: [route("env2", "filter.cutoff", 0.15), route("velocity", "oscA.detune", 0.1)],
    fx: {
      chorus: { enabled: true, rate: 0.4, depth: 0.3, mix: 0.2 },
      delay: { enabled: true, time: "1/8d", feedback: 0.3, mix: 0.18, pingPong: true },
      reverb: { enabled: true, size: 0.7, decay: 0.55, damping: 0.4, mix: 0.22 },
      ott: { enabled: true, depth: 0.3, time: 0.5 },
    },
    master: { volume: 0.6 },
  }),
  preset("wide-strings", "PD Wide Strings", {
    oscA: { table: table("basic"), position: 0.6, level: 0.65, unison: 11, detune: 0.2, blend: 0.75, spread: 1 },
    oscB: { enabled: true, table: table("pwm"), position: 0.35, level: 0.45, unison: 7, detune: 0.18, blend: 0.7, spread: 1 },
    filter: { cutoff: 2400, resonance: 0.1 },
    env1: { attack: 0.6, decay: 1, sustain: 0.9, release: 2 },
    lfos: lfos({ sync: false, rate: 0.12 }, { sync: false, rate: 5 }),
    mod: [route("lfo1", "filter.cutoff", 0.12), route("lfo2", "oscA.fine", 0.03), route("lfo1", "oscB.position", 0.25)],
    fx: {
      chorus: { enabled: true, rate: 0.35, depth: 0.6, mix: 0.35 },
      reverb: { enabled: true, size: 0.85, decay: 0.7, damping: 0.45, mix: 0.4 },
      eq: { enabled: true, low: -2, mid: 0, high: 1.5 },
    },
    master: { volume: 0.62 },
  }),
]

/** The patch loaded at startup: the 80s poly brass the default hook is written for. */
export const DEFAULT_PRESET_ID = "factory/poly-brass"

export const presetCategory = (p: Patch) => p.name.slice(0, 2) as PresetCategory
