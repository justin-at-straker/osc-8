// The factory bank. Each preset is defaultPatch() plus an edit, so presets
// stay valid as the schema grows. Only what M1 can sound is set: osc A
// (table, position, level, tuning), the low-pass filter, the amp envelope,
// master volume and the FX chain.
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

export const FACTORY_PRESETS: Patch[] = [
  preset("dark-reese", "BS Reese Dark", {
    oscA: { table: table("pwm"), position: 0.62, octave: -2, fine: -9, level: 0.8 },
    filter: { cutoff: 420, resonance: 0.35 },
    env1: { attack: 0.004, decay: 0.4, sustain: 0.9, release: 0.14 },
    fx: {
      distortion: { enabled: true, type: "tube", drive: 0.35, mix: 0.6 },
      chorus: { enabled: true, rate: 0.22, depth: 0.85, mix: 0.55 },
      ott: { enabled: true, depth: 0.35, time: 0.5 },
    },
    master: { volume: 0.72 },
  }),
  preset("sub-round", "BS Sub Round", {
    oscA: { table: table("basic"), position: 0, octave: -2, level: 0.85 },
    filter: { cutoff: 260, resonance: 0.05 },
    env1: { attack: 0.003, decay: 0.2, sustain: 1, release: 0.12 },
    fx: { eq: { enabled: true, low: 3, mid: 0, high: -4 } },
    master: { volume: 0.8 },
  }),
  preset("fold-grit", "BS Fold Grit", {
    oscA: { table: table("digital"), position: 0.35, octave: -2, level: 0.75 },
    filter: { cutoff: 1400, resonance: 0.3 },
    env1: { attack: 0.002, decay: 0.3, sustain: 0.7, release: 0.1 },
    fx: {
      distortion: { enabled: true, type: "fold", drive: 0.7, mix: 0.8 },
      ott: { enabled: true, depth: 0.7, time: 0.3 },
      eq: { enabled: true, low: 3, mid: 1, high: -2 },
    },
    master: { volume: 0.62 },
  }),
  preset("glass-pluck", "LD Glass Pluck", {
    oscA: { table: table("harmonic-sweep"), position: 0.7 },
    filter: { cutoff: 5200, resonance: 0.25 },
    env1: { attack: 0.002, decay: 0.35, sustain: 0.15, release: 0.3 },
    fx: {
      delay: { enabled: true, time: "1/8d", feedback: 0.3, mix: 0.2, pingPong: true },
      reverb: { enabled: true, size: 0.5, decay: 0.45, damping: 0.4, mix: 0.2 },
    },
  }),
  preset("vox-formant", "LD Vox Formant", {
    oscA: { table: table("formant"), position: 0.45, fine: 4 },
    filter: { cutoff: 3200, resonance: 0.3 },
    env1: { attack: 0.02, decay: 0.6, sustain: 0.8, release: 0.35 },
    fx: {
      chorus: { enabled: true, rate: 0.6, depth: 0.3, mix: 0.3 },
      reverb: { enabled: true, size: 0.55, decay: 0.5, damping: 0.5, mix: 0.18 },
    },
  }),
  preset("bit-crush", "LD Bit Crush", {
    oscA: { table: table("digital"), position: 0.8 },
    filter: { cutoff: 9000, resonance: 0.1 },
    env1: { attack: 0.001, decay: 0.25, sustain: 0.6, release: 0.15 },
    fx: {
      distortion: { enabled: true, type: "bitcrush", drive: 0.6, mix: 0.7 },
      delay: { enabled: true, time: "1/16", feedback: 0.2, mix: 0.15, pingPong: false },
    },
    master: { volume: 0.6 },
  }),
  preset("wide-saw", "LD Wide Saw", {
    oscA: { table: table("basic"), position: 0.66, fine: 6 },
    filter: { cutoff: 7000, resonance: 0.15 },
    env1: { attack: 0.01, decay: 0.4, sustain: 0.85, release: 0.3 },
    fx: {
      chorus: { enabled: true, rate: 0.9, depth: 0.9, mix: 0.6 },
      reverb: { enabled: true, size: 0.45, decay: 0.4, damping: 0.5, mix: 0.25 },
      ott: { enabled: true, depth: 0.3, time: 0.5 },
      eq: { enabled: true, low: -2, mid: 0, high: 2 },
    },
    master: { volume: 0.62 },
  }),
  preset("halo", "PD Halo", {
    oscA: { table: table("harmonic-sweep"), position: 0.3 },
    filter: { cutoff: 2400, resonance: 0.15 },
    env1: { attack: 1.2, decay: 1.5, sustain: 0.8, release: 2.5 },
    fx: {
      chorus: { enabled: true, rate: 0.3, depth: 0.7, mix: 0.5 },
      reverb: { enabled: true, size: 0.9, decay: 0.85, damping: 0.4, mix: 0.5 },
    },
    master: { volume: 0.65 },
  }),
  preset("pwm-arp", "PL PWM Arp", {
    oscA: { table: table("pwm"), position: 0.5 },
    filter: { cutoff: 3000, resonance: 0.4 },
    env1: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.12 },
    fx: {
      delay: { enabled: true, time: "1/8d", feedback: 0.45, mix: 0.3, pingPong: true },
      reverb: { enabled: true, size: 0.4, decay: 0.35, damping: 0.5, mix: 0.15 },
    },
  }),
  preset("bell-tine", "PL Bell Tine", {
    oscA: { table: table("digital"), position: 0.55, octave: 1 },
    filter: { cutoff: 12000, resonance: 0.05 },
    env1: { attack: 0.001, decay: 1.4, sustain: 0, release: 1.2 },
    fx: {
      chorus: { enabled: true, rate: 0.4, depth: 0.2, mix: 0.2 },
      reverb: { enabled: true, size: 0.6, decay: 0.6, damping: 0.3, mix: 0.3 },
      eq: { enabled: true, low: -3, mid: 0, high: 3 },
    },
    master: { volume: 0.6 },
  }),
  preset("lofi-keys", "KY Lo-Fi Keys", {
    oscA: { table: table("basic"), position: 0.2 },
    filter: { cutoff: 1800, resonance: 0.1 },
    env1: { attack: 0.005, decay: 0.8, sustain: 0.4, release: 0.4 },
    fx: {
      distortion: { enabled: true, type: "bitcrush", drive: 0.3, mix: 0.35 },
      chorus: { enabled: true, rate: 1.6, depth: 0.25, mix: 0.35 },
      reverb: { enabled: true, size: 0.35, decay: 0.35, damping: 0.7, mix: 0.2 },
      eq: { enabled: true, low: 2, mid: -2, high: -6 },
    },
  }),
  preset("metal-drone", "FX Metal Drone", {
    oscA: { table: table("digital"), position: 0.9, semi: 7 },
    filter: { cutoff: 6000, resonance: 0.7 },
    env1: { attack: 2, decay: 2, sustain: 0.9, release: 4 },
    fx: {
      distortion: { enabled: true, type: "fold", drive: 0.5, mix: 0.6 },
      delay: { enabled: true, time: "1/4t", feedback: 0.7, mix: 0.4, pingPong: true },
      reverb: { enabled: true, size: 0.95, decay: 0.9, damping: 0.3, mix: 0.55 },
    },
    master: { volume: 0.55 },
  }),
]

export const presetCategory = (p: Patch) => p.name.slice(0, 2) as PresetCategory
