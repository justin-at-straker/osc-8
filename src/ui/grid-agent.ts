// The step grids as UI SDK components, so the agent can write patterns.
//
// A grid is ONE component (the roll's or the 808's role=grid element) whose
// value is the list of lit cells, by label ("C4, bar 2, step 5", "Kick, bar 1,
// step 1"), across every bar, not only the one on screen. The agent calls
// toggle / add / remove / clear (and accent on the 808) with a cell label;
// the app sees the change through onValueChange with source "agent", exactly
// like a person's edit. One component instead of 400 cell toggles keeps the
// agent's snapshot small and lets it address any bar without paging.
import { createChange, definePrimitive } from "@ui-sdk/core"
import { createParts } from "@ui-sdk/react/primitive"

export type GridItem = { value: string; label: string }

type GridOptions = {
  value?: string[]
  onValueChange?: (value: string[], details: { source: string }) => void
  accents?: string[]
  onAccentsChange?: (accents: string[], details: { source: string }) => void
  /** Every addressable cell. Value and label are the same text. */
  items?: GridItem[]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

function makeGrid(name: string, accentable: boolean) {
  return definePrimitive({
    name,
    options: {
      value: "value",
      onValueChange: "callback",
      accents: "value",
      onAccentsChange: "callback",
      items: "value",
    },
    controlled: ["value", "accents"],
    state: (options: GridOptions) => ({ value: options.value ?? [], accents: options.accents ?? [] }),
    sync: (options) => ({
      ...(options.value ? { value: options.value } : {}),
      ...(options.accents ? { accents: options.accents } : {}),
    }),
    api: (context) => {
      const change = createChange(context)
      const items = () => context.options().items ?? []
      /** A cell by its label (or value), any case and spacing. */
      const cell = (name: string) => {
        const want = norm(String(name))
        const found = items().find((i) => norm(i.value) === want || norm(i.label) === want)
        if (!found) throw new Error(`No cell "${name}". Cells are named like "${items()[0]?.label ?? "C4, bar 1, step 1"}".`)
        return found.value
      }
      const value = () => context.store.get().value
      const set = (next: string[], event?: Event) => change("value", next, { reason: "item-press", event })
      return {
        items,
        /** Light the cell if it's off, turn it off if it's on. */
        toggle: (name: string, event?: Event) => {
          const c = cell(name)
          return set(value().includes(c) ? value().filter((v) => v !== c) : [...value(), c], event)
        },
        /** Light the cell (no change if it's already lit). */
        add: (name: string) => {
          const c = cell(name)
          return value().includes(c) ? false : set([...value(), c])
        },
        /** Turn the cell off (no change if it's off). */
        remove: (name: string) => {
          const c = cell(name)
          return value().includes(c) ? set(value().filter((v) => v !== c)) : false
        },
        /** Turn every cell off. */
        clear: () => set([]),
        /** Toggle the cell's accent; an unlit cell becomes an accented hit. */
        accent: (name: string) => {
          const c = cell(name)
          const accents = context.store.get().accents
          return change("accents", accents.includes(c) ? accents.filter((a) => a !== c) : [...accents, c], { reason: "item-press" })
        },
      }
    },
    slots: (slot) => ({ root: slot({}) }),
    agent: {
      actions: accentable ? ["toggle", "add", "remove", "accent", "clear"] : ["toggle", "add", "remove", "clear"],
      items: (api) => api.items(),
    },
  })
}

export const noteGrid = makeGrid("note-grid", false)
export const drumGridPrimitive = makeGrid("drum-grid", true)

export const NoteGridRoot = createParts(noteGrid, { root: "div" }).Root
export const DrumGridRoot = createParts(drumGridPrimitive, { root: "div" }).Root
