import * as React from "react"
import { spatialMove } from "@ui-sdk/core"
import { endGesture, getState, setPattern, useStore } from "@/state/store"
import { Button } from "@/components/ui/button"
import { Display } from "@/components/ui/display"
import { Icon } from "@/components/ui/icon"
import { StepperControl } from "./controls"
import { DEMO_PATTERN } from "./pattern-presets"
import { cellKey, coverage, noteName, removeNoteAt, ROLL_BOTTOM, ROLL_TOP, setNoteLength, toggleCell } from "./roll-model"

// The piano roll, adapted from the SPEC-01 midi-editor block and bound to the
// store's pattern. Rows run from the top note down; a note covers `length`
// cells from its start. Click an empty cell to write a note of the current
// length, click a note to remove it, or press on a cell and drag right to
// draw (or redraw) a note to that length. On the keyboard: arrows move,
// Enter toggles, Shift+Left/Right shortens or lengthens, Delete removes.

const ROWS = Array.from({ length: ROLL_TOP - ROLL_BOTTOM + 1 }, (_, i) => ROLL_TOP - i)

/** The pattern editor: C3..C5 by 16 steps, with a playhead column from the engine's step. */
export function PianoRoll({
  seed = true,
  barSlot,
  trackSlot,
}: {
  seed?: boolean
  /** Rendered at the start of the pattern bar (the mod source strip). */
  barSlot?: React.ReactNode
  /** Rendered before the pattern legend (the SYNTH | 808 track keys). */
  trackSlot?: React.ReactNode
}) {
  const pattern = useStore((s) => s.pattern)
  const step = useStore((s) => s.step)
  const playing = useStore((s) => s.transport.playing)
  const [length, setLength] = React.useState(1)

  // Seed the demo line once, so the first press of play makes sound.
  React.useEffect(() => {
    if (seed && getState().pattern.notes.length === 0) setPattern(DEMO_PATTERN, "load")
  }, [seed])

  const owner = React.useMemo(() => coverage(pattern), [pattern])
  const steps = pattern.steps

  // Drag to draw a note's length. The press anchors on the note under it (or
  // the cell, if empty); moving right along the row sets the length.
  const drag = React.useRef<{ note: number; anchor: number; moved: boolean; id: number } | null>(null)
  const swallowClick = React.useRef(false)

  const onCellPointerDown = (event: React.PointerEvent<HTMLButtonElement>, note: number, column: number) => {
    if (event.button !== 0) return
    swallowClick.current = false
    const at = owner.get(cellKey(note, column))
    const anchor = at !== undefined ? pattern.notes[at].step : column
    drag.current = { note, anchor, moved: false, id: event.pointerId }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onCellPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    const cell = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-cell]")
    if (!cell?.dataset.cell) return
    const [cellNote, cellStep] = cell.dataset.cell.split(":").map(Number)
    if (cellNote !== d.note || cellStep < d.anchor) return
    const span = cellStep - d.anchor + 1
    const current = getState().pattern.notes.find((n) => n.note === d.note && n.step === d.anchor)
    if (current?.length === span || (!d.moved && !current && span === 1)) return
    d.moved = true
    setNoteLength(d.note, d.anchor, span)
  }
  const onCellPointerUp = () => {
    if (drag.current?.moved) swallowClick.current = true
    drag.current = null
    endGesture()
  }
  const onCellClick = (note: number, column: number) => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    toggleCell(note, column, length)
  }

  // The roll is one tab stop; arrows move by UI SDK's spatialMove, as in the midi-editor block.
  const [active, setActive] = React.useState(cellKey(60, 0))
  const move = React.useMemo(() => spatialMove(), [])
  const onRollKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (!target.matches('[role="gridcell"]') || !target.dataset.cell) return
    const [note, column] = target.dataset.cell.split(":").map(Number)
    const at = owner.get(cellKey(note, column))

    if (event.shiftKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault()
      const existing = at !== undefined ? pattern.notes[at] : undefined
      if (existing) setNoteLength(note, existing.step, existing.length + (event.key === "ArrowRight" ? 1 : -1))
      else if (event.key === "ArrowRight") setNoteLength(note, column, 2)
      return
    }
    if ((event.key === "Delete" || event.key === "Backspace") && at !== undefined) {
      event.preventDefault()
      removeNoteAt(at)
      return
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="gridcell"]')].map((el) => ({
      key: el.dataset.cell!,
      props: {},
      el,
    }))
    const from = items.find((item) => item.el === target)
    if (!from) return
    const key = move(event.nativeEvent, { from, items, rtl: false })
    const next = key && items.find((item) => item.key === key)
    if (!next) return
    event.preventDefault()
    setActive(key)
    next.el.focus()
  }

  return (
    <div data-osc-roll>
      <div data-osc-roll-bar>
        {barSlot}
        {trackSlot}
        <h2>Pattern</h2>
        <StepperControl label="Note length" legend="Len" value={length} min={1} max={steps} onValueChange={setLength} />
        <Button aria-label="Clear pattern" onClick={() => setPattern({ ...pattern, notes: [] })}>
          <Icon name="trash" />
        </Button>
      </div>
      {/* The screen fills the height left in the device (see osc.css), not a fixed aspect. */}
      <Display aspect="auto">
        <div
          data-roll
          data-osc-grid
          role="grid"
          aria-multiselectable="true"
          aria-label="Piano roll"
          onKeyDown={onRollKey}
          style={{ gridTemplateRows: `repeat(${ROWS.length}, 1fr) 9px` }}
        >
          {ROWS.map((note) => {
            const name = noteName(note)
            const sharp = name.includes("#")
            const octaveC = name.startsWith("C") && !sharp
            return (
              <div key={note} role="row" data-roll-row data-sharp={sharp || undefined} data-octave={octaveC || undefined}>
                <span role="rowheader" data-roll-key aria-label={name}>
                  {octaveC ? name : ""}
                </span>
                {Array.from({ length: steps }, (_, c) => {
                  const at = owner.get(cellKey(note, c))
                  const n = at !== undefined ? pattern.notes[at] : undefined
                  const key = cellKey(note, c)
                  return (
                    <button
                      key={c}
                      type="button"
                      role="gridcell"
                      data-cell={key}
                      tabIndex={active === key ? 0 : -1}
                      onFocus={() => setActive(key)}
                      aria-label={`${name}, step ${c + 1}${n ? (n.step === c ? `, ${n.length} step note` : ", held") : ""}`}
                      aria-selected={n !== undefined}
                      data-start={(n && n.step === c) || undefined}
                      data-held={(n && n.step !== c) || undefined}
                      data-tail={(n && n.step + n.length - 1 === c) || undefined}
                      data-beat={c % 4 === 0 || undefined}
                      data-now={c === step || undefined}
                      onPointerDown={(event) => onCellPointerDown(event, note, c)}
                      onPointerMove={onCellPointerMove}
                      onPointerUp={onCellPointerUp}
                      onPointerCancel={() => (drag.current = null)}
                      onClick={() => onCellClick(note, c)}
                    />
                  )
                })}
              </div>
            )
          })}
          <div data-roll-steps aria-hidden>
            <span />
            {Array.from({ length: steps }, (_, c) => (
              <i
                key={c}
                data-beat={c % 4 === 0 || undefined}
                data-filled={pattern.notes.some((n) => n.step === c) || undefined}
                data-now={(playing && c === step) || undefined}
              />
            ))}
          </div>
        </div>
      </Display>
    </div>
  )
}
