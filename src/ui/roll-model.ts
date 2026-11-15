// Pattern editing for the piano roll: pure-ish helpers over the store's pattern.
import { getState, setPattern } from "@/state/store"
import type { Note, Pattern } from "@/engine/protocol"

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
/** MIDI note name, C4 = 60. */
export const noteName = (note: number) => `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`

export const ROLL_TOP = 72 // C5
export const ROLL_BOTTOM = 48 // C3
export const VELOCITY = 0.8

export const cellKey = (note: number, step: number) => `${note}:${step}`
const sortNotes = (notes: Note[]) => [...notes].sort((a, b) => a.step - b.step || b.note - a.note)

/** Which note covers each cell, by index into pattern.notes. */
export function coverage(pattern: Pattern) {
  const owner = new Map<string, number>()
  pattern.notes.forEach((n, i) => {
    for (let s = n.step; s < Math.min(pattern.steps, n.step + n.length); s++) owner.set(cellKey(n.note, s), i)
  })
  return owner
}

/** Longest a note starting here can be before it runs into the next note on its row or off the end. */
function room(pattern: Pattern, note: number, step: number, ignore?: number) {
  let limit = pattern.steps - step
  pattern.notes.forEach((n, i) => {
    if (i !== ignore && n.note === note && n.step > step) limit = Math.min(limit, n.step - step)
  })
  return Math.max(1, limit)
}

function write(pattern: Pattern, notes: Note[]) {
  setPattern({ ...pattern, notes: sortNotes(notes) })
}

/** Toggle a cell: remove the note covering it, or write a new one of `length` steps. */
export function toggleCell(note: number, step: number, length = 1) {
  const pattern = getState().pattern
  const at = coverage(pattern).get(cellKey(note, step))
  if (at !== undefined) return removeNoteAt(at)
  write(pattern, [...pattern.notes, { step, note, length: Math.min(length, room(pattern, note, step)), velocity: VELOCITY }])
}

export function removeNoteAt(index: number) {
  const pattern = getState().pattern
  write(pattern, pattern.notes.filter((_, i) => i !== index))
}

/** Set the length of the note starting at `step` (writing it if it isn't there), clipped to the room on its row. */
export function setNoteLength(note: number, step: number, length: number) {
  const pattern = getState().pattern
  const at = pattern.notes.findIndex((n) => n.note === note && n.step === step)
  const clipped = Math.max(1, Math.min(length, room(pattern, note, step, at)))
  if (at < 0) return write(pattern, [...pattern.notes, { step, note, length: clipped, velocity: VELOCITY }])
  write(pattern, pattern.notes.map((n, i) => (i === at ? { ...n, length: clipped } : n)))
}

/** A cell's name everywhere (people, the agent, tests): "C4, bar 2, step 5", bar and step 1-based. */
export const rollCellLabel = (note: number, step: number) => `${noteName(note)}, bar ${Math.floor(step / 16) + 1}, step ${(step % 16) + 1}`
