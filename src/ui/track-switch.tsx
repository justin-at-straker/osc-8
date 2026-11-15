import { haptic } from "@/lib/haptics"
import type { Track } from "./drum-model"

const TRACKS: { value: Track; label: string; name: string }[] = [
  { value: "synth", label: "Synth", name: "Synth track" },
  { value: "808", label: "808", name: "808 drum track" },
]

/** Two latching keys over the pattern screen: which track's pattern it shows. */
export function TrackSwitch({ track, onTrackChange }: { track: Track; onTrackChange: (track: Track) => void }) {
  return (
    <div data-osc-track-switch role="radiogroup" aria-label="Track">
      {TRACKS.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={track === t.value}
          aria-label={t.name}
          data-osc-track-key
          tabIndex={track === t.value ? 0 : -1}
          onClick={() => {
            if (t.value !== track) haptic("selection")
            onTrackChange(t.value)
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
            event.preventDefault()
            const next = TRACKS[(TRACKS.findIndex((x) => x.value === track) + 1) % TRACKS.length]
            onTrackChange(next.value)
            ;(event.currentTarget.parentElement?.querySelector(`[aria-label="${next.name}"]`) as HTMLElement | null)?.focus()
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
