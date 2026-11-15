// AI tools. Two families share the one patch store and its undo history:
//  - patch tools (getPatch/setPatch) design a sound by editing the patch directly
//  - UI tools (snapshot/query/act) move the visible controls through the UI SDK
//    agent bridge, exactly as a person would, reporting source "agent"
import { jsonSchema, tool, type ToolSet } from "ai"
import { z } from "zod"
import { BUILTIN_TABLES, Patch, type PatchEdit } from "@/engine/patch"
import { ALL_PARAM_KEYS, MOD_TARGETS } from "@/engine/params"
import { editPatch, getState, setPattern, setTransport } from "@/state/store"
import type { UiAgent } from "./ui-agent"

/** Patch fields the M1 engine actually renders. Everything else validates and is stored, but is silent for now. */
export const AUDIBLE_PARAMS: readonly string[] = ALL_PARAM_KEYS

const SECTION_HINTS: Record<string, string> = {
  name: "Short descriptive patch name, max 64 chars, e.g. 'Dark Detuned Reese'. Always set it.",
  oscA: "Wavetable oscillator A. table: {kind:'builtin', name} where name is one of " +
    BUILTIN_TABLES.join(", ") +
    ". position 0..1 morphs through the table's frames. level 0..1. octave -4..4, semi -12..12 (integers), fine -100..100 cents.",
  oscB: "Wavetable oscillator B (not audible in M1).",
  sub: "Sub oscillator (not audible in M1).",
  noise: "Noise source (not audible in M1).",
  filter: "Filter. cutoff in Hz 20..20000 (log-ish: 200 dark, 1000 warm, 4000 open, 12000 bright). resonance 0..1 (0.7+ whistles). enabled toggles it. In M1 only lp24 is rendered.",
  env1: "Amp envelope. attack/decay/release in seconds 0..20, sustain 0..1.",
  env2: "Envelope 2: a mod source (0..1 per note), audible only through a mod route. Times in seconds.",
  env3: "Envelope 3: a mod source like env2.",
  lfos: "Exactly 4 LFOs, full array required. Each: shape sine|triangle|saw|square|random (random = sample & hold), rate Hz when sync is false, sync true uses syncDivision (1/1,1/2,1/4,1/8,1/16,1/4t,1/8t,1/8d; retriggers each note), oneShot runs one cycle. Audible only through mod routes.",
  mod: `Mod matrix: up to 16 routes, full array required (it replaces the old one; include existing routes you keep). Each { source, target, amount -1..1, aux }. source/aux: none, env1..env3, lfo1..lfo4, velocity, modwheel, note, random. target must be one of: ${Object.keys(MOD_TARGETS).join(", ")}. amount 1 sweeps the target's full range upward from its knob value (cutoff in octaves/log space), so 0.1-0.4 is typical; aux scales the amount by another source (aux "none" = off).`,
  fx: "Effects; each effect may be given partially. Turn on only what the sound needs.",
  voicing: "Voicing (not audible in M1).",
  master: "Master volume 0..1.",
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Every object level optional; arrays and the wavetable union stay whole. */
function deepPartial(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodType> = {}
    for (const [k, v] of Object.entries(schema.shape as Record<string, z.ZodType>)) shape[k] = deepPartial(v).optional()
    // Strict, so a misspelled field is an error the model sees, not silently dropped.
    return z.strictObject(shape)
  }
  return schema
}

function buildSetPatchInput() {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, field] of Object.entries(Patch.shape as Record<string, z.ZodType>)) {
    if (key === "version" || key === "id") continue
    const hint = SECTION_HINTS[key]
    const partial = deepPartial(field).optional()
    shape[key] = hint ? partial.describe(hint) : partial
  }
  return z.strictObject(shape)
}

/** The setPatch input: the patch minus version/id, every object level optional. */
export const SetPatchInput = buildSetPatchInput()

/** Merge a deep-partial edit into the current patch, section by section, so editPatch gets whole sections. */
export function mergeEdit(current: Patch, input: Record<string, unknown>): PatchEdit {
  const merge = (base: unknown, patch: unknown): unknown => {
    // A wavetable ref (has `kind`) and arrays are replaced whole.
    if (!isPlainObject(base) || !isPlainObject(patch) || "kind" in patch) return patch
    const out: Record<string, unknown> = { ...base }
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = merge(base[k], v)
    return out
  }
  const edit: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue
    edit[k] = merge((current as Record<string, unknown>)[k], v)
  }
  return edit as PatchEdit
}

/** Dotted paths that differ between two patches, for the tool result. */
function diffPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].flatMap((k) => diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k))
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix]
}

function describeError(error: unknown): string {
  if (error instanceof z.ZodError) return z.prettifyError(error)
  return error instanceof Error ? error.message : String(error)
}

export type SetPatchResult =
  | { ok: true; name: string; changed: string[]; silentInM1: string[] }
  | { ok: false; error: string }

/** Apply a setPatch input to the store as one undo step, source "ai". Never throws: errors come back for the model. */
export function applySetPatch(input: unknown): SetPatchResult {
  const parsed = SetPatchInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: `Invalid setPatch input, nothing changed:\n${describeError(parsed.error)}` }
  const before = getState().patch
  try {
    const after = editPatch(mergeEdit(before, parsed.data as Record<string, unknown>), "ai")
    const changed = diffPaths(before, after)
    const silentInM1 = changed.filter((p) => p !== "name" && !AUDIBLE_PARAMS.some((a) => p === a || p.startsWith(`${a}.`)))
    return { ok: true, name: after.name, changed, silentInM1 }
  } catch (error) {
    return { ok: false, error: `Patch rejected, nothing changed:\n${describeError(error)}` }
  }
}

const SET_PATCH_DESCRIPTION = `Design a sound by editing the synth patch. Give only what you change; every object level is optional and merges onto the current patch (arrays and oscillator 'table' are replaced whole). All changes apply as one undo step. Units: Hz for cutoff, seconds for envelope times, 0..1 for levels/amounts, integers for octave/semi.
AUDIBLE NOW: oscA (table, position, level, octave, semi, fine), filter (enabled, cutoff, resonance; rendered as lp24), env1 (amp), env2/env3/lfos via mod routes, the mod matrix, every fx section, master.volume. NOT YET AUDIBLE (saved for later): oscB, sub, noise, unison/detune/blend/spread/warp/pan/phase, filter types other than lp24, voicing.
Always include a short descriptive 'name'. On { ok: false } read the error, fix the input and call again.`

export function createPatchTools() {
  return {
    getPatch: tool({
      description: "Returns the current synth patch as JSON (engineering units). Call it before editing when you need exact current values.",
      inputSchema: z.object({}),
      execute: async () => ({ patch: getState().patch, audibleInM1: AUDIBLE_PARAMS }),
    }),
    setPatch: tool({
      description: SET_PATCH_DESCRIPTION,
      // Validation runs in execute (not the SDK) so bad input becomes a tool
      // result the model can read and retry, instead of a thrown error.
      inputSchema: jsonSchema<Record<string, unknown>>(z.toJSONSchema(SetPatchInput, { io: "input" }) as never),
      execute: async (input) => applySetPatch(input),
    }),
    getPattern: tool({
      description: "Returns the current 16-step pattern (notes with step, MIDI note, length in steps, velocity) and the tempo.",
      inputSchema: z.object({}),
      execute: async () => ({ pattern: getState().pattern, bpm: getState().transport.bpm }),
    }),
    setPattern: tool({
      description: SET_PATTERN_DESCRIPTION,
      inputSchema: jsonSchema<Record<string, unknown>>(z.toJSONSchema(SetPatternInput, { io: "input" }) as never),
      execute: async (input) => applySetPattern(input),
    }),
  } satisfies ToolSet
}

// ---- Music: the AI writes the pattern too ----

/** The piano roll shows C3..C5 and 16 steps; notes outside it would be invisible, so the tool enforces it. */
export const PATTERN_NOTE_MIN = 48
export const PATTERN_NOTE_MAX = 72
export const PATTERN_STEPS = 16

export const SetPatternInput = z
  .object({
    notes: z
      .array(
        z
          .object({
            step: z.number().int().min(0).max(PATTERN_STEPS - 1).describe("Start step, 0..15 (16th notes; 0, 4, 8, 12 are the beats)."),
            note: z.number().int().min(PATTERN_NOTE_MIN).max(PATTERN_NOTE_MAX).describe("MIDI note, 48 (C3) .. 72 (C5). 60 = C4."),
            length: z.number().int().min(1).max(PATTERN_STEPS).describe("Length in 16th-note steps. Notes may run past step 15; they wrap."),
            velocity: z.number().min(0.05).max(1).describe("0..1; vary it (e.g. 0.6 ghost notes, 1.0 accents) for groove."),
          })
          .strict()
      )
      .max(64)
      .describe("Every note of the new pattern. Replaces the whole pattern. An empty array clears it."),
    bpm: z.number().min(60).max(200).optional().describe("Tempo, if the request implies one (house ~124, techno ~130, dnb ~174, hip-hop ~90)."),
  })
  .strict()

export type SetPatternResult = { ok: true; notes: number; bpm: number } | { ok: false; error: string }

export function applySetPattern(input: unknown): SetPatternResult {
  const parsed = SetPatternInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) }
  const { notes, bpm } = parsed.data
  // One note per (step, pitch): later duplicates win.
  const unique = new Map(notes.map((n) => [`${n.step}:${n.note}`, n]))
  const sorted = [...unique.values()].sort((a, b) => a.step - b.step || a.note - b.note)
  setPattern({ steps: PATTERN_STEPS, notes: sorted }, "ai")
  if (bpm !== undefined) setTransport({ bpm: Math.round(bpm) })
  return { ok: true, notes: sorted.length, bpm: getState().transport.bpm }
}

const SET_PATTERN_DESCRIPTION = `Write the music: replace the 16-step pattern the synth plays in a loop (one bar of 16th notes). Notes are MIDI numbers within C3..C5 (48..72) because that is the piano roll's visible range; to make a bass sound low, write the line in this range and set the patch's oscA.octave to -1 or -2 with setPatch, rather than writing lower notes. Optionally set bpm. Undo restores the previous pattern.`

/**
 * The UI SDK bridge's own tools (`agentTools`: snapshot, query, act), routed to
 * the bridge. Descriptions and schemas are the library's.
 */
export function createUiTools(agent: UiAgent, defs: readonly { name: string; description: string; inputSchema: unknown }[]) {
  const tools: ToolSet = {}
  for (const def of defs) {
    const name = def.name as "snapshot" | "query" | "act"
    if (!(name in agent)) continue
    tools[name] = tool({
      description: def.description,
      inputSchema: jsonSchema<Record<string, unknown>>(def.inputSchema as never),
      execute: async (input) => {
        try {
          return await (agent[name] as (i: unknown) => unknown)(input ?? {})
        } catch (error) {
          return { ok: false, error: describeError(error) }
        }
      },
    })
  }
  return tools
}
