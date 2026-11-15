import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/react/segmented-control"
import { haptic } from "@/lib/haptics"
import type { Track } from "./drum-model"
import { glow } from "./agent-glow"

const TRACKS: { value: Track; label: string; name: string }[] = [
  { value: "synth", label: "Synth", name: "Synth track" },
  { value: "808", label: "808", name: "808 drum track" },
]

/**
 * Two latching keys over the pattern screen: which track's pattern it shows.
 * A UI SDK segmented control labelled "Track", so the agent can switch it
 * (items "Synth track" / "808 drum track").
 */
export function TrackSwitch({ track, onTrackChange }: { track: Track; onTrackChange: (track: Track) => void }) {
  return (
    <SegmentedControl<Track>
      data-osc-track-switch
      aria-label="Track"
      value={track}
      onValueChange={(next, details) => {
        if (next === null || next === track) return
        haptic("selection")
        if (details?.source === "agent") glow("[data-osc-track-switch]")
        onTrackChange(next as Track)
      }}
    >
      {TRACKS.map((t) => (
        <SegmentedControlItem key={t.value} value={t.value} data-osc-track-key aria-label={t.name}>
          {t.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}
