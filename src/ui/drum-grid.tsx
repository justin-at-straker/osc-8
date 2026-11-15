import * as React from "react"
import { spatialMove } from "@ui-sdk/core"
import { DRUM_LABELS, DRUM_SHORT, DRUM_VOICES, type DrumVoice } from "@/engine/drums"
import { endGesture, getState, useStore } from "@/state/store"
import { Button } from "@/components/ui/button"
import { Display } from "@/components/ui/display"
import { Icon } from "@/components/ui/icon"
import { drumCellLabel, clearDrums, hasHit, HIT_VELOCITY, seedDrums, selectVoice, setHit, toggleAccent, toggleHit, useSelectedVoice } from "./drum-model"
import type { EngineControls } from "./types"
import { BarSelect, LengthSelect, Overview } from "./pattern-nav"
import { usePatternPage } from "./use-pattern-page"
import { BAR_STEPS, setDrumBars, setPage, showBar } from "./pattern-paging"
import { DrumGridRoot } from "./grid-agent"
import { glow } from "./agent-glow"


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
  const playing = useStore((s) => s.transport.playing)
  const selected = useSelectedVoice()

  React.useEffect(() => {
    if (seed) seedDrums()
  }, [seed])

  const hits = React.useMemo(() => new Map(pattern.hits.map((h) => [cellKey(h.voice, h.step), h])), [pattern])
  // The agent's view of the grid: every cell in every bar by name; lit hits and accented hits.
  const cells = React.useMemo(() => {
    const byLabel = new Map<string, { voice: DrumVoice; step: number }>()
    for (const voice of DRUM_VOICES) for (let st = 0; st < pattern.steps; st++) byLabel.set(drumCellLabel(voice, st), { voice, step: st })
    return byLabel
  }, [pattern.steps])
  const items = React.useMemo(() => [...cells.keys()].map((label) => ({ value: label, label })), [cells])
  const lit = React.useMemo(() => pattern.hits.map((h) => drumCellLabel(h.voice, h.step)), [pattern])
  const accented = React.useMemo(() => pattern.hits.filter((h) => h.accent).map((h) => drumCellLabel(h.voice, h.step)), [pattern])
  const showAgentEdit = (touched: { voice: DrumVoice; step: number }[], source: string) => {
    endGesture()
    if (source !== "agent" || touched.length === 0) return
    setPage("808", Math.floor(touched[touched.length - 1].step / BAR_STEPS))
    for (const c of touched) glow(`[data-drum-cell="${cellKey(c.voice, c.step)}"]`)
  }
  const onAgentValue = (next: string[], details: { source: string }) => {
    const before = new Set(lit)
    const after = new Set(next)
    const touched: { voice: DrumVoice; step: number }[] = []
    for (const label of new Set([...before, ...after])) {
      if (before.has(label) === after.has(label)) continue
      const c = cells.get(label)
      if (!c) continue
      setHit(c.voice, c.step, after.has(label))
      touched.push(c)
    }
    showAgentEdit(touched, details.source)
  }
  const onAgentAccents = (next: string[], details: { source: string }) => {
    const before = new Set(accented)
    const after = new Set(next)
    const touched: { voice: DrumVoice; step: number }[] = []
    for (const label of new Set([...before, ...after])) {
      if (before.has(label) === after.has(label)) continue
      const c = cells.get(label)
      if (!c) continue
      toggleAccent(c.voice, c.step)
      touched.push(c)
    }
    showAgentEdit(touched, details.source)
  }

  // One bar shows at a time; `first` is its first absolute step.
  const { page, bars, first, follow, here, noteEdit } = usePatternPage("808", pattern.steps)
  const columns = Array.from({ length: Math.min(BAR_STEPS, pattern.steps - first) }, (_, i) => first + i)
  const marks = React.useMemo(
    () => pattern.hits.map((h): [number, number, number] => [h.step, 1, DRUM_VOICES.indexOf(h.voice) / (DRUM_VOICES.length - 1)]),
    [pattern]
  )

  // Paint: the press decides add or erase; moving along the row applies it to each cell passed.
  const paint = React.useRef<{ voice: DrumVoice; on: boolean; id: number } | null>(null)
  const pointerHandled = React.useRef(false)
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>, voice: DrumVoice, column: number) => {
    if (event.button !== 0) return
    pointerHandled.current = true
    noteEdit(column)
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
    noteEdit(column)
    toggleHit(voice, column)
  }

  const [active, setActive] = React.useState(cellKey("kick", 0))
  const move = React.useMemo(() => spatialMove(), [])
  // Arrowing off the edge of the bar pages to the next one; the cell is focused once it renders.
  const pendingFocus = React.useRef<string | null>(null)
  React.useEffect(() => {
    const key = pendingFocus.current
    if (!key) return
    pendingFocus.current = null
    document.querySelector<HTMLElement>(`[data-drum-cell="${key}"]`)?.focus()
  }, [page])
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (!target.dataset.drumCell) return
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault()
      const [voice, column] = target.dataset.drumCell.split(":")
      toggleAccent(voice as DrumVoice, Number(column))
      return
    }
    const [voice, col] = target.dataset.drumCell.split(":")
    const column = Number(col)
    const edge = event.key === "ArrowRight" ? first + BAR_STEPS - 1 : event.key === "ArrowLeft" ? first : -1
    if (column === edge && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const to = event.key === "ArrowRight" ? page + 1 : page - 1
      if (to >= 0 && to < bars) {
        event.preventDefault()
        const key = `${voice}:${column + (event.key === "ArrowRight" ? 1 : -1)}`
        setActive(key)
        pendingFocus.current = key
        showBar("808", to)
      }
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
        <LengthSelect label="Drum pattern length" steps={pattern.steps} onBars={setDrumBars} />
        <BarSelect track="808" label="Drum pattern bar" page={page} bars={bars} follow={follow} />
        <Button aria-label="Clear drum pattern" onClick={clearDrums}>
          <Icon name="trash" />
        </Button>
      </div>
      <Display aspect="auto">
        <DrumGridRoot
          value={lit}
          onValueChange={onAgentValue}
          accents={accented}
          onAccentsChange={onAgentAccents}
          items={items}
          data-roll
          data-osc-grid
          data-osc-drum-grid
          role="grid"
          aria-multiselectable="true"
          aria-label="Drum grid"
          onKeyDown={onKey}
          data-bars={bars}
          style={{ gridTemplateRows: `${bars > 1 ? "16px " : ""}repeat(${DRUM_VOICES.length}, 1fr) 9px` }}
        >
          <Overview track="808" label="Drum pattern overview" steps={pattern.steps} page={page} here={here} marks={marks} />
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
                {columns.map((c) => {
                  const i = c - first
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
                      aria-label={`${drumCellLabel(voice, c)}${hit?.accent ? ", accent" : ""}`}
                      aria-selected={!!hit}
                      data-accent={hit?.accent || undefined}
                      data-beat={i % 4 === 0 || undefined}
                      data-now={c === here || undefined}
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
            {columns.map((c) => (
              <i key={c} data-beat={(c - first) % 4 === 0 || undefined} data-filled={pattern.hits.some((h) => h.step === c) || undefined} data-now={(playing && c === here) || undefined} />
            ))}
          </div>
        </DrumGridRoot>
      </Display>
    </div>
  )
}
