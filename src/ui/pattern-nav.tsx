import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/react/segmented-control"
import { haptic } from "@/lib/haptics"
import type { Track } from "./drum-model"
import { BAR_STEPS, barsOf, LENGTH_BARS, setFollow, showBar } from "./pattern-paging"

/** A row of small latching keys on the UI SDK segmented control. */
function KeyRow<T extends string>({
  label,
  value,
  options,
  onChange,
  legend,
}: {
  label: string
  value: T
  options: { value: T; label: string; name?: string }[]
  onChange: (value: T) => void
  legend: string
}) {
  return (
    <div data-osc-keyrow>
      <span data-osc-keyrow-legend aria-hidden>
        {legend}
      </span>
      <SegmentedControl<T>
        data-osc-keys
        aria-label={label}
        value={value}
        onValueChange={(next) => {
          if (next === null || next === value) return
          haptic("selection")
          onChange(next as T)
        }}
      >
        {options.map((o) => (
          <SegmentedControlItem key={o.value} value={o.value} data-osc-key aria-label={o.name}>
            {o.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  )
}

/** Pattern length: 1, 2, 4 or 8 bars. */
export function LengthSelect({ label, steps, onBars }: { label: string; steps: number; onBars: (bars: number) => void }) {
  return (
    <KeyRow
      label={label}
      legend="Bars"
      value={String(barsOf(steps))}
      options={LENGTH_BARS.map((b) => ({ value: String(b), label: String(b), name: `${b} bar${b > 1 ? "s" : ""}` }))}
      onChange={(next) => onBars(Number(next))}
    />
  )
}

/** Bar keys 1..N and the follow toggle; nothing for a one-bar pattern. */
export function BarSelect({ track, label, page, bars, follow }: { track: Track; label: string; page: number; bars: number; follow: boolean }) {
  if (bars < 2) return null
  return (
    <div data-osc-bar-select>
      <KeyRow
        label={label}
        legend="Bar"
        value={String(page)}
        options={Array.from({ length: bars }, (_, i) => ({ value: String(i), label: String(i + 1), name: `Bar ${i + 1}` }))}
        onChange={(next) => showBar(track, Number(next))}
      />
      <button
        type="button"
        data-osc-follow
        aria-pressed={follow}
        aria-label={track === "808" ? "Follow playhead (drums)" : "Follow playhead"}
        title="Page with the playhead while playing"
        onClick={() => setFollow(track, !follow)}
      >
        <i aria-hidden />
        Follow
      </button>
    </div>
  )
}

/**
 * The whole pattern in one strip: a cell per bar with its notes as tiny marks,
 * the shown bar outlined and the playhead as a line. Press a bar to show it.
 */
export function Overview({
  track,
  steps,
  page,
  here,
  marks,
  label,
}: {
  track: Track
  steps: number
  page: number
  here: number
  /** Marks as [step, length, row 0..1 from the top]. */
  marks: [number, number, number][]
  label: string
}) {
  const bars = barsOf(steps)
  if (bars < 2) return null
  return (
    <div data-osc-overview role="group" aria-label={label} style={{ gridTemplateColumns: `34px repeat(${bars}, 1fr)` }}>
      <span aria-hidden />
      {Array.from({ length: bars }, (_, b) => {
        const first = b * BAR_STEPS
        const inBar = marks.filter(([s]) => s >= first && s < first + BAR_STEPS)
        const playhead = here >= first && here < first + BAR_STEPS ? here - first : -1
        return (
          <button
            key={b}
            type="button"
            data-osc-overview-bar
            data-shown={b === page || undefined}
            aria-label={`Show bar ${b + 1}`}
            aria-current={b === page || undefined}
            onClick={() => showBar(track, b)}
          >
            <svg viewBox={`0 0 ${BAR_STEPS} 10`} preserveAspectRatio="none" aria-hidden>
              {inBar.map(([s, len, row], i) => (
                <rect key={i} x={s - first} y={row * 9} width={Math.max(0.6, Math.min(len, first + BAR_STEPS - s) - 0.25)} height={1.2} />
              ))}
              {playhead >= 0 && <line data-osc-overview-head x1={playhead + 0.5} x2={playhead + 0.5} y1={0} y2={10} />}
            </svg>
          </button>
        )
      })}
    </div>
  )
}
