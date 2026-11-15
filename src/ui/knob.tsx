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

/** A point on the dial's ring, radius r, at travel t (0..1 over the 270deg sweep). */
function ringPoint(t: number, r: number) {
  const angle = ((-135 + t * 270 - 90) * Math.PI) / 180
  return [Math.cos(angle) * r, Math.sin(angle) * r] as const
}

/** The mod arc: from the knob's value to where its routes take it, and the live value as a dot. */
function ModRing({ from, to, family, live }: KnobRing & { from: number; live?: number }) {
  const r = 46
  const [x0, y0] = ringPoint(from, r)
  const [x1, y1] = ringPoint(to, r)
  const sweep = Math.abs(to - from) * 270
  const d = sweep < 0.5 ? "" : `M ${x0} ${y0} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} ${to > from ? 1 : 0} ${x1} ${y1}`
  const dot = live === undefined ? null : ringPoint(live, r)
  return (
    <g data-osc-mod-ring data-family={family}>
      {d && <path d={d} />}
      <circle data-osc-mod-end cx={x1} cy={y1} r={2.6} />
      {dot && <circle data-osc-mod-live cx={dot[0]} cy={dot[1]} r={3.2} />}
    </g>
  )
}

function KnobTicks({ lit, ring, travel, live }: { lit: number; ring?: KnobRing; travel: number; live?: number }) {
  return (
    <svg data-kit="knob-ticks" viewBox="-50 -50 100 100" aria-hidden overflow="visible">
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
      {ring && <ModRing {...ring} from={travel} live={live} />}
    </svg>
  )
}

/** Modulation drawn on a knob, all in travel (0..1 of the knob's turn). */
export type KnobRing = {
  /** Where the routes take the value. */
  to: number
  family: "lfo" | "env" | "other"
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
  /** Printed readout, for units Intl can't format (dB, Hz). The input still holds the number; this shows while it isn't focused. */
  displayValue?: (value: number) => string
  /** Modulation to draw on the tick ring. */
  ring?: KnobRing
  /** The engine's live modulated value (same units as `value`), drawn as a moving dot on the ring. */
  liveValue?: number
  /**
   * Drag on the ring (or Alt+drag anywhere on the dial) to set modulation
   * depth instead of the value. `begin` is called on press; `move` with the
   * travel moved since, up positive.
   */
  ringDrag?: { begin(): void; move(deltaTravel: number): void }
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
  displayValue,
  ring,
  ringDrag,
  liveValue,
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
  const drag = React.useRef<{ y: number; travel: number; id: number; ring: boolean } | null>(null)
  const onPointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    // On the outer ring (the ticks) or with Alt: the mod depth, when there is one.
    const box = event.currentTarget.getBoundingClientRect()
    const dx = event.clientX - (box.left + box.width / 2)
    const dy = event.clientY - (box.top + box.height / 2)
    const onRing = box.width > 0 && Math.hypot(dx, dy) > box.width * 0.4
    const ringMode = !!ringDrag && !!ring && (event.altKey || onRing)
    if (ringMode) ringDrag.begin()
    drag.current = { y: event.clientY, travel: latest.current.travel, id: event.pointerId, ring: ringMode }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    const fine = event.shiftKey ? 0.2 : 1
    const moved = ((d.y - event.clientY) / FULL_TURN_PX) * fine
    if (d.ring) ringDrag?.move(moved)
    else commit(toTravelValue(d.travel + moved))
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
        data-modulated={ring ? ring.family : undefined}
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
          <KnobTicks
            lit={litTicks(travel)}
            ring={ring}
            travel={travel}
            live={ring && liveValue !== undefined ? toTravel(liveValue, min, max, taper) : undefined}
          />
          <span data-kit="knob-cap" />
        </span>
        {displayValue ? (
          <span data-osc-readout>
            <NumberInputControl data-kit="knob-readout" aria-label={label} aria-valuetext={displayValue(value)} onKeyDown={onKeyDown} />
            <span data-osc-readout-text aria-hidden>
              {displayValue(value)}
            </span>
          </span>
        ) : (
          <NumberInputControl data-kit="knob-readout" aria-label={label} onKeyDown={onKeyDown} />
        )}
        <span data-kit="label" aria-hidden>
          {legend ?? label}
        </span>
      </div>
    </NumberInput>
  )
}
