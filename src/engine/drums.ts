// The drum machine contract: an 808-style synthesized kit on its own track.
// Shared by the store, the UI, the AI tools and the engine (via param IDs and
// the drum pattern messages in protocol.ts).
import { z } from "zod"

/** Voice order is the engine's voice index. Append only. */
export const DRUM_VOICES = ["kick", "snare", "clap", "rim", "closedHat", "openHat", "lowTom", "midTom", "highTom", "cowbell", "cymbal"] as const
export type DrumVoice = (typeof DRUM_VOICES)[number]

export const DRUM_LABELS: Record<DrumVoice, string> = {
  kick: "Kick",
  snare: "Snare",
  clap: "Clap",
  rim: "Rimshot",
  closedHat: "Closed hat",
  openHat: "Open hat",
  lowTom: "Low tom",
  midTom: "Mid tom",
  highTom: "High tom",
  cowbell: "Cowbell",
  cymbal: "Cymbal",
}

/** Short names for grid rows. */
export const DRUM_SHORT: Record<DrumVoice, string> = {
  kick: "BD", snare: "SD", clap: "CP", rim: "RS", closedHat: "CH", openHat: "OH",
  lowTom: "LT", midTom: "MT", highTom: "HT", cowbell: "CB", cymbal: "CY",
}

const unit = z.number().min(0).max(1)

/**
 * One voice's controls, all 0..1 with 0.5 = the classic default:
 * - tune: pitch (kick: ~45..65 Hz fundamental; toms/cowbell: their pitch; hats/cymbal: metallic brightness)
 * - decay: length (kick 0.5 ~ 0.5 s boom; hats short..long)
 * - tone: kick = click/attack amount, snare = tone vs noise balance, hats/cymbal = brightness filter, others = body/brightness
 * - snappy: snare noise amount (ignored by other voices)
 */
export const DrumVoiceParams = z.object({
  level: unit,
  tune: unit,
  decay: unit,
  tone: unit,
  snappy: unit,
  pan: z.number().min(-1).max(1),
  mute: z.boolean(),
})
export type DrumVoiceParams = z.infer<typeof DrumVoiceParams>

export const DrumKit = z.object({
  voices: z.object(Object.fromEntries(DRUM_VOICES.map((v) => [v, DrumVoiceParams])) as Record<DrumVoice, typeof DrumVoiceParams>),
  /** How much louder accented steps are (808 "accent"). */
  accent: unit,
  /** Drum bus: level, saturation drive, and swing (0 straight .. 1 heavy shuffle on off-16ths). */
  level: unit,
  drive: unit,
  swing: unit,
})
export type DrumKit = z.infer<typeof DrumKit>

export type DrumHit = {
  step: number // 0..15
  voice: DrumVoice
  /** 0..1; the grid uses 0.8 for normal hits. */
  velocity: number
  accent: boolean
}
export type DrumPattern = { steps: number; hits: DrumHit[] }

const voice = (o: Partial<DrumVoiceParams> = {}): DrumVoiceParams => ({ level: 0.8, tune: 0.5, decay: 0.5, tone: 0.5, snappy: 0.5, pan: 0, mute: false, ...o })

export function defaultKit(): DrumKit {
  return {
    voices: {
      kick: voice({ level: 0.9, decay: 0.55, tone: 0.4 }),
      snare: voice({ level: 0.75, snappy: 0.6 }),
      clap: voice({ level: 0.7 }),
      rim: voice({ level: 0.55 }),
      closedHat: voice({ level: 0.55, decay: 0.3, pan: 0.15 }),
      openHat: voice({ level: 0.5, decay: 0.5, pan: 0.15 }),
      lowTom: voice({ level: 0.65, tune: 0.4, pan: -0.25 }),
      midTom: voice({ level: 0.65, pan: 0 }),
      highTom: voice({ level: 0.65, tune: 0.6, pan: 0.25 }),
      cowbell: voice({ level: 0.5, pan: -0.1 }),
      cymbal: voice({ level: 0.45, decay: 0.6, pan: 0.2 }),
    },
    accent: 0.5,
    level: 0.8,
    drive: 0.15,
    swing: 0,
  }
}

// ---- Engine param IDs: 1000 + voice*8 + field, then the bus at 1100. ----
export const DRUM_PARAM_BASE = 1000
export const DRUM_VOICE_STRIDE = 8
const VOICE_FIELDS = ["level", "tune", "decay", "tone", "snappy", "pan", "mute"] as const // offsets 0..6, 7 reserved
export const DRUM_BUS = { accent: 1100, level: 1101, drive: 1102, swing: 1103 } as const

export function kitToParams(kit: DrumKit): [number, number][] {
  const out: [number, number][] = []
  DRUM_VOICES.forEach((v, i) => {
    VOICE_FIELDS.forEach((f, j) => {
      const value = kit.voices[v][f]
      out.push([DRUM_PARAM_BASE + i * DRUM_VOICE_STRIDE + j, typeof value === "boolean" ? (value ? 1 : 0) : value])
    })
  })
  out.push([DRUM_BUS.accent, kit.accent], [DRUM_BUS.level, kit.level], [DRUM_BUS.drive, kit.drive], [DRUM_BUS.swing, kit.swing])
  return out
}

/** A starter beat so the 808 track plays something: four-on-the-floor house under the default riff. */
export const DEMO_DRUMS: DrumPattern = {
  steps: 16,
  hits: [
    ...[0, 4, 8, 12].map((step) => ({ step, voice: "kick" as const, velocity: 0.95, accent: step === 0 })),
    ...[4, 12].map((step) => ({ step, voice: "clap" as const, velocity: 0.8, accent: false })),
    ...[1, 3, 5, 7, 9, 11, 13, 15].map((step) => ({ step, voice: "closedHat" as const, velocity: step % 4 === 3 ? 0.55 : 0.4, accent: false })),
    ...[2, 6, 10, 14].map((step) => ({ step, voice: "openHat" as const, velocity: 0.6, accent: false })),
  ],
}
