import * as React from "react"
import { spatialMove } from "@ui-sdk/core"
import { DRUM_LABELS, DRUM_SHORT, DRUM_VOICES, type DrumVoice } from "@/engine/drums"
import { endGesture, getState, useStore } from "@/state/store"
import { Button } from "@/components/ui/button"
import { Display } from "@/components/ui/display"
import { Icon } from "@/components/ui/icon"
import { clearDrums, hasHit, HIT_VELOCITY, seedDrums, selectVoice, setHit, toggleAccent, toggleHit, useSelectedVoice } from "./drum-model"
import type { EngineControls } from "./types"

// The 808 step grid, in the piano roll's black glass: a row per voice, 16
// steps. Click toggles a hit; press and drag paints (or erases, if the press
// started on a hit) along the row; Shift+click or right-click toggles accent.
// Arrows move, Enter toggles, Shift+Enter accents. A row's label plays the
// voice and selects it on the DRUM tab.

const cellKey = (voice: DrumVoice, step: number) => `${voice}:${step}`

export function DrumGrid({
  engine,
  barSlot,
  trackSlot,
  seed = true,
}: {
  engine?: EngineControls
  /** Rendered at the start of the bar (the mod source strip). */
  barSlot?: React.ReactNode
  /** Rendered before the pattern legend (the track keys). */
  trackSlot?: React.ReactNode
  seed?: boolean
}) {
  const pattern = useStore((s) => s.drums.pattern)
  const voices = useStore((s) => s.drums.kit.voices)
  const step = useStore((s) => s.step)
  const playing = useStore((s) => s.transport.playing)
  const selected = useSelectedVoice()

  React.useEffect(() => {
    if (seed) seedDrums()
  }, [seed])

  const hits = React.useMemo(() => new Map(pattern.hits.map((h) => [cellKey(h.voice, h.step), h])), [pattern])

  // Paint: the press decides add or erase; moving along the row applies it to each cell passed.
  const paint = React.useRef<{ voice: DrumVoice; on: boolean; id: number } | null>(null)
  const pointerHandled = React.useRef(false)
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>, voice: DrumVoice, column: number) => {
    if (event.button !== 0) return
    pointerHandled.current = true
    if (event.shiftKey) {
      toggleAccent(voice, column)
      return
    }
    const on = !hasHit(getState().drums.pattern, voice, column)
    paint.current = { voice, on, id: event.pointerId }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setHit(voice, column, on)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const p = paint.current
    if (!p || p.id !== event.pointerId) return
    const cell = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-drum-cell]")
    if (!cell?.dataset.drumCell) return
    const [voice, column] = cell.dataset.drumCell.split(":")
    if (voice !== p.voice) return
    setHit(p.voice, Number(column), p.on)
  }
  const endPaint = () => {
    paint.current = null
    endGesture()
    // The click that follows this release is skipped; forget the press once it has passed.
    window.setTimeout(() => (pointerHandled.current = false), 0)
  }
  // A click that pointerdown already handled is skipped; keyboard Enter and assistive clicks toggle here.
  const onClick = (voice: DrumVoice, column: number) => {
    if (pointerHandled.current) {
      pointerHandled.current = false
      return
    }
    toggleHit(voice, column)
  }

  const [active, setActive] = React.useState(cellKey("kick", 0))
  const move = React.useMemo(() => spatialMove(), [])
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (!target.dataset.drumCell) return
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault()
      const [voice, column] = target.dataset.drumCell.split(":")
      toggleAccent(voice as DrumVoice, Number(column))
      return
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-drum-cell]")].map((el) => ({ key: el.dataset.drumCell!, props: {}, el }))
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
    <div data-osc-roll data-osc-drums>
      <div data-osc-roll-bar>
        {barSlot}
        {trackSlot}
        <h2>808 Pattern</h2>
        <Button aria-label="Clear drum pattern" onClick={clearDrums}>
          <Icon name="trash" />
        </Button>
      </div>
      <Display aspect="auto">
        <div
          data-roll
          data-osc-grid
          data-osc-drum-grid
          role="grid"
          aria-multiselectable="true"
          aria-label="808 step grid"
          onKeyDown={onKey}
          style={{ gridTemplateRows: `repeat(${DRUM_VOICES.length}, 1fr) 9px` }}
        >
          {DRUM_VOICES.map((voice, index) => {
            const name = DRUM_LABELS[voice]
            return (
              <div key={voice} role="row" data-roll-row data-muted={voices[voice].mute || undefined} data-selected={voice === selected || undefined}>
                <button
                  type="button"
                  role="rowheader"
                  data-roll-key
                  data-drum-key
                  aria-label={name}
                  title={`Play ${name}`}
                  onClick={() => {
                    selectVoice(voice)
                    engine?.triggerDrum?.(index, HIT_VELOCITY)
                  }}
                >
                  {DRUM_SHORT[voice]}
                </button>
                {Array.from({ length: pattern.steps }, (_, c) => {
                  const hit = hits.get(cellKey(voice, c))
                  const key = cellKey(voice, c)
                  return (
                    <button
                      key={c}
                      type="button"
                      role="gridcell"
                      data-drum-cell={key}
                      tabIndex={active === key ? 0 : -1}
                      onFocus={() => setActive(key)}
                      aria-label={`${name}, step ${c + 1}${hit?.accent ? ", accent" : ""}`}
                      aria-selected={!!hit}
                      data-accent={hit?.accent || undefined}
                      data-beat={c % 4 === 0 || undefined}
                      data-now={c === step || undefined}
                      onPointerDown={(event) => onPointerDown(event, voice, c)}
                      onPointerMove={onPointerMove}
                      onPointerUp={endPaint}
                      onPointerCancel={endPaint}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        toggleAccent(voice, c)
                      }}
                      onClick={() => onClick(voice, c)}
                    />
                  )
                })}
              </div>
            )
          })}
          <div data-roll-steps aria-hidden>
            <span />
            {Array.from({ length: pattern.steps }, (_, c) => (
              <i key={c} data-beat={c % 4 === 0 || undefined} data-filled={pattern.hits.some((h) => h.step === c) || undefined} data-now={(playing && c === step) || undefined} />
            ))}
          </div>
        </div>
      </Display>
    </div>
  )
}
