// MIDI -> OSC-8: quantize to 16th-note steps, pick a window of bars, and turn
// melodic tracks into the synth pattern (folded into the roll's C3..C5) and
// channel-10 drums into the 808 pattern (General MIDI mapping).
import type { DrumHit, DrumPattern, DrumVoice } from "@/engine/drums"
import type { Note, Pattern } from "@/engine/protocol"
import type { Smf, SmfNote } from "./smf"

export const STEPS_PER_BAR = 16
export const BAR_CHOICES = [1, 2, 4, 8] as const
export const DRUM_CHANNEL = 9 // "channel 10"
export const ROLL_LOW = 48 // C3
export const ROLL_HIGH = 72 // C5
export const MAX_NOTES = 512

/** General MIDI percussion -> 808 voice. Anything else is ignored. */
export const GM_DRUMS: Record<number, DrumVoice> = {
  35: "kick", 36: "kick",
  38: "snare", 40: "snare",
  39: "clap",
  37: "rim",
  42: "closedHat", 44: "closedHat",
  46: "openHat",
  41: "lowTom", 43: "lowTom", 45: "lowTom",
  47: "midTom", 48: "midTom",
  50: "highTom",
  56: "cowbell",
  49: "cymbal", 51: "cymbal", 52: "cymbal", 55: "cymbal", 57: "cymbal", 59: "cymbal",
}
export const ACCENT_VELOCITY = 110

/** A note quantized to 16th-note steps from the start of the song. */
export type StepNote = { step: number; length: number; note: number; velocity: number; channel: number }

export function quantize(notes: SmfNote[], ppq: number): StepNote[] {
  const tps = ppq / 4
  return notes.map((n) => ({
    step: Math.max(0, Math.round(n.tick / tps)),
    length: Math.max(1, Math.round(n.durationTicks / tps)),
    note: n.note,
    velocity: n.velocity,
    channel: n.channel,
  }))
}

/** Tempo to the transport's 60..200 BPM, doubling or halving into range. */
export function tempoToBpm(bpm: number): number {
  let b = bpm
  if (!Number.isFinite(b) || b <= 0) return 120
  while (b > 200) b /= 2
  while (b < 60) b *= 2
  return Math.round(Math.min(200, Math.max(60, b)))
}

/** The first bar with notes and how many bars hold notes from there. */
export function contentBars(notes: StepNote[]) {
  if (notes.length === 0) return { firstBar: 0, barCount: 1 }
  const first = Math.min(...notes.map((n) => n.step))
  const last = Math.max(...notes.map((n) => n.step))
  const firstBar = Math.floor(first / STEPS_PER_BAR)
  return { firstBar, barCount: Math.floor(last / STEPS_PER_BAR) - firstBar + 1 }
}

/** The smallest bar choice that holds `count` bars, at most 8. */
export const fitBars = (count: number) => BAR_CHOICES.find((b) => b >= count) ?? 8

/**
 * The octave shift (a multiple of 12, -48..48) that puts the most notes in
 * C3..C5; ties go to the smallest shift.
 */
export function chooseShift(notes: { note: number }[]): number {
  let best = 0
  let bestCount = -1
  for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
    const shift = k * 12
    const count = notes.filter((n) => n.note + shift >= ROLL_LOW && n.note + shift <= ROLL_HIGH).length
    if (count > bestCount) {
      best = shift
      bestCount = count
    }
  }
  return best
}

/** Fold a note by octaves into C3..C5. */
export function fold(note: number) {
  let n = note
  while (n < ROLL_LOW) n += 12
  while (n > ROLL_HIGH) n -= 12
  return n
}

export type ImportOptions = {
  /** Tracks whose melodic (non-channel-10) notes go to the synth. */
  melodicTracks: number[]
  /** Tracks whose channel-10 notes go to the 808. */
  drumTracks: number[]
  /** 0-based first bar; default: the first bar with selected notes. */
  startBar?: number
  /** 1, 2, 4 or 8; default: as many as the selected notes need, up to 8. */
  bars?: number
}

export type ImportResult = {
  startBar: number
  bars: number
  steps: number
  /** The synth pattern, or null when no melodic track was chosen. */
  pattern: Pattern | null
  drums: DrumPattern | null
  /** The octave shift applied to the notes (+24 = moved up two octaves). */
  shift: number
  /** osc A octave to compensate, -4..4. */
  octave: number
  /** Notes folded by an extra octave to fit the roll. */
  folded: number
  /** Notes dropped by the 512-note cap. */
  dropped: number
  bpm: number | null
}

export function convert(smf: Smf, options: ImportOptions): ImportResult {
  const pick = (indexes: number[], keep: (n: SmfNote) => boolean) =>
    quantize(
      smf.tracks.filter((t) => indexes.includes(t.index)).flatMap((t) => t.notes.filter(keep)),
      smf.ppq
    )
  const melodic = pick(options.melodicTracks, (n) => n.channel !== DRUM_CHANNEL)
  const drumNotes = pick(options.drumTracks, (n) => n.channel === DRUM_CHANNEL && GM_DRUMS[n.note] !== undefined)

  const content = contentBars([...melodic, ...drumNotes])
  const startBar = Math.max(0, options.startBar ?? content.firstBar)
  const bars = options.bars ?? fitBars(Math.max(1, content.firstBar + content.barCount - startBar))
  const steps = bars * STEPS_PER_BAR
  const first = startBar * STEPS_PER_BAR
  const inWindow = <T extends { step: number }>(n: T) => n.step >= first && n.step < first + steps

  // Melodic: shift, fold, de-duplicate (keep the loudest), cap.
  const window = melodic.filter(inWindow)
  const shift = chooseShift(window)
  let folded = 0
  const byCell = new Map<string, Note>()
  for (const n of window) {
    const moved = n.note + shift
    const note = fold(moved)
    if (note !== moved) folded++
    const step = n.step - first
    const key = `${step}:${note}`
    const velocity = Math.round((n.velocity / 127) * 1000) / 1000
    const prev = byCell.get(key)
    if (!prev || velocity > prev.velocity) byCell.set(key, { step, note, length: n.length, velocity })
  }
  const sorted = [...byCell.values()].sort((a, b) => a.step - b.step || b.note - a.note)
  const notes = sorted.slice(0, MAX_NOTES)

  // Drums: GM map, one hit per voice and step (the loudest), accent at velocity >= 110.
  const hits = new Map<string, DrumHit>()
  for (const n of drumNotes.filter(inWindow)) {
    const voice = GM_DRUMS[n.note]
    const step = n.step - first
    const key = `${step}:${voice}`
    const velocity = Math.round((n.velocity / 127) * 1000) / 1000
    const prev = hits.get(key)
    if (!prev || velocity > prev.velocity) hits.set(key, { step, voice, velocity, accent: n.velocity >= ACCENT_VELOCITY })
  }

  return {
    startBar,
    bars,
    steps,
    pattern: options.melodicTracks.length ? { steps, notes } : null,
    drums: options.drumTracks.length ? { steps, hits: [...hits.values()].sort((a, b) => a.step - b.step) } : null,
    shift,
    octave: Math.max(-4, Math.min(4, -shift / 12)),
    folded,
    dropped: sorted.length - notes.length,
    bpm: smf.bpm ? tempoToBpm(smf.bpm) : null,
  }
}

/** "128 steps, 412 notes, shifted +12, osc A octave -1; 96 drum hits". */
export function describe(result: ImportResult): string {
  const parts = [`${result.bars} bar${result.bars > 1 ? "s" : ""} (${result.steps} steps) from bar ${result.startBar + 1}`]
  if (result.pattern) {
    const n = result.pattern.notes.length
    parts.push(`${n} note${n === 1 ? "" : "s"}`)
    if (result.shift) parts.push(`shifted ${result.shift > 0 ? "+" : ""}${result.shift}, osc A octave ${result.octave > 0 ? "+" : ""}${result.octave}`)
    if (result.folded) parts.push(`${result.folded} folded into range`)
    if (result.dropped) parts.push(`${result.dropped} over the ${MAX_NOTES}-note limit dropped`)
  }
  if (result.drums) parts.push(`${result.drums.hits.length} drum hit${result.drums.hits.length === 1 ? "" : "s"}`)
  return parts.join(", ")
}

/** Which tracks the dialog preselects: the busiest non-drum track, and every track with channel-10 notes. */
export function defaultSelection(smf: Smf) {
  const melodicCount = (i: number) => smf.tracks[i].notes.filter((n) => n.channel !== DRUM_CHANNEL).length
  const busiest = smf.tracks.map((t) => t.index).filter((i) => melodicCount(i) > 0).sort((a, b) => melodicCount(b) - melodicCount(a))[0]
  return {
    melodicTracks: busiest === undefined ? [] : [busiest],
    drumTracks: smf.tracks.filter((t) => t.notes.some((n) => n.channel === DRUM_CHANNEL)).map((t) => t.index),
  }
}
