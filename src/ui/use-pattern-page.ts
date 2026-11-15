import * as React from "react"
import { useStore } from "@/state/store"
import type { Track } from "./drum-model"
import { BAR_STEPS, barsOf, localStep, setFollow, setPage, usePaging } from "./pattern-paging"

/**
 * The paging for one track's grid: which bar shows, following the playhead
 * while playing (unless the person picked a bar or edited elsewhere), and
 * follow turning back on whenever play starts.
 */
export function usePatternPage(track: Track, steps: number) {
  const { page, follow } = usePaging(track)
  const step = useStore((s) => s.step)
  const playing = useStore((s) => s.transport.playing)
  const bars = barsOf(steps)
  const here = localStep(step, steps)

  // Play starting again re-arms follow.
  React.useEffect(() => {
    if (playing) setFollow(track, true)
  }, [playing, track])
  // Follow: page to the playhead's bar.
  React.useEffect(() => {
    if (playing && follow && here >= 0) setPage(track, Math.floor(here / BAR_STEPS))
  }, [playing, follow, here, track])
  // Shortening the pattern can strand the page past the end.
  React.useEffect(() => {
    if (page >= bars) setPage(track, bars - 1)
  }, [page, bars, track])

  const shown = Math.min(page, bars - 1)
  return {
    page: shown,
    bars,
    first: shown * BAR_STEPS,
    follow,
    /** The playhead within this track, -1 when stopped. */
    here,
    /** An edit at `absolute` step: if it's outside the playhead's bar while playing, stop following. */
    noteEdit: (absolute: number) => {
      if (playing && here >= 0 && Math.floor(absolute / BAR_STEPS) !== Math.floor(here / BAR_STEPS)) setFollow(track, false)
    },
  }
}
