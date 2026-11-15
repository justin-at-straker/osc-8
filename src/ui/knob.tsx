import * as React from "react"
import { NumberInput, NumberInputControl } from "@ui-sdk/react/number-input"
import { haptic } from "@/lib/haptics"
import { fromTravel, LINEAR, snap, toTravel, type Taper } from "./taper"

// A synth knob in the SPEC-01 flat-knob skin, but holding its value in the
// parameter's own units (Hz, seconds, 0..1) rather than 0..100. The readout
// is the UI SDK number input, so the agent sees "Filter cutoff = 4000" and can
// set it by label. The dial turns by travel through a taper, so a log knob
// spends as much of its turn on 20..200 Hz as on 2k..20k.

const knobTicks = 27
const litTicks = (travel: number) => Math.floor(travel * knobTicks)

function KnobTicks({ lit }: { lit: number }) {
  return (
    <svg data-kit="knob-ticks" viewBox="-50 -50 100 100" aria-hidden>
      {Array.from({ length: knobTicks + 1 }, (_, i) => {
        const angle = ((-135 + (i / knobTicks) * 270 - 90) * Math.PI) / 180
        return (
          <line
            key={i}
            x1={Math.cos(angle) * 40}
            y1={Math.sin(angle) * 40}
            x2={Math.cos(angle) * 50}
            y2={Math.sin(angle) * 50}
            data-major={i % 9 === 0 || undefined}
            data-lit={i <= lit || undefined}
          />
        )
      })}
    </svg>
  )
}

export type KnobProps = {
  /** Accessible name, what the UI SDK agent matches, e.g. "Filter cutoff". */
  label: string
  /** The short legend printed under the knob, e.g. "CUTOFF". Defaults to the label. */
  legend?: string
  /** Dotted patch path for `data-param`, e.g. "filter.cutoff". */
  param?: string
  value: number
  min: number
  max: number
  /** Value grid for typed and stepped values. */
  step?: number
  taper?: Taper
  /** Intl.NumberFormat options for the readout. */
  format?: Intl.NumberFormatOptions
  color?: "white" | "orange" | "green" | "blue"
  /** Double-click the dial to return here. */
  resetValue?: number
  onValueChange: (value: number) => void
}

/** Drag sensitivity: pixels of vertical travel for the whole turn. */
const FULL_TURN_PX = 220

export function Knob({
  label,
  legend,
  param,
  value,
  min,
  max,
  step,
  taper = LINEAR,
  format,
  color = "white",
  resetValue,
  onValueChange,
}: KnobProps) {
  const travel = toTravel(value, min, max, taper)
  // The last value sent, so a drag doesn't resend the same value and knows where it is between renders.
  const latest = React.useRef({ value, travel })
  React.useLayoutEffect(() => {
    latest.current = { value, travel }
  }, [value, travel])

  const commit = (next: number) => {
    const clean = snap(next, min, max, step)
    if (clean === latest.current.value) return
    if (litTicks(toTravel(clean, min, max, taper)) !== litTicks(latest.current.travel)) haptic("selection")
    latest.current = { value: clean, travel: toTravel(clean, min, max, taper) }
    onValueChange(clean)
  }
  const toTravelValue = (t: number) => fromTravel(t, min, max, taper)

  // Drag up/down on the dial: travel, not value, so every taper feels even.
  const drag = React.useRef<{ y: number; travel: number; id: number } | null>(null)
  const onPointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { y: event.clientY, travel: latest.current.travel, id: event.pointerId }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    const fine = event.shiftKey ? 0.2 : 1
    commit(toTravelValue(d.travel + ((d.y - event.clientY) / FULL_TURN_PX) * fine))
  }
  const endDrag = () => (drag.current = null)

  // Arrow keys on the readout move by travel too: 1% a press, 10% with Shift.
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const by = event.shiftKey ? 0.1 : 0.01
    // Left and Right stay with the text caret.
    const moves: Record<string, number> = { ArrowUp: by, ArrowDown: -by, PageUp: 0.1, PageDown: -0.1 }
    if (event.key in moves) {
      event.preventDefault()
      commit(toTravelValue(latest.current.travel + moves[event.key]))
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      commit(event.key === "Home" ? min : max)
    }
  }

  return (
    <NumberInput
      data-param={param}
      min={min}
      max={max}
      step={step}
      format={format}
      locale="en-US"
      value={value}
      onValueChange={(next) => next !== null && Number.isFinite(next) && commit(next)}
    >
      <div
        data-kit="knob"
        data-color={color}
        style={{ "--turn": `${travel * 270 - 135}deg`, "--lit": travel } as React.CSSProperties}
      >
        <span
          data-kit="knob-dial"
          data-osc-dial
          aria-hidden
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => resetValue !== undefined && commit(resetValue)}
        >
          <KnobTicks lit={litTicks(travel)} />
          <span data-kit="knob-cap" />
        </span>
        <NumberInputControl data-kit="knob-readout" aria-label={label} onKeyDown={onKeyDown} />
        <span data-kit="label" aria-hidden>
          {legend ?? label}
        </span>
      </div>
    </NumberInput>
  )
}
