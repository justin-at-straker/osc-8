import * as React from "react"
import { canRedo, canUndo, redo, setTransport, undo, useStore } from "@/state/store"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Lcd, LcdDigits } from "@/components/ui/lcd"
import { ParamKnob } from "./controls"
import { Knob } from "./knob"
import { isTextEntry } from "./keys"
import { MAX_BPM, MIN_BPM, togglePlay } from "./transport-actions"
import { BAR_STEPS, barsOf } from "./pattern-paging"
import type { EngineControls } from "./types"

/** Space toggles play anywhere except in text entry. */
function useSpaceToPlay(engine?: EngineControls) {
  const toggle = React.useEffectEvent(() => togglePlay(engine))
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return
      if (event.defaultPrevented || event.repeat || isTextEntry(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // Also stops a focused key or cell from being pressed by the same Space.
      event.preventDefault()
      toggle()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

/**
 * The transport strip: an LCD with tempo, playhead step and (optionally) the
 * QWERTY octave, the play/stop key, the tempo encoder and master volume.
 */
export function Transport({ engine, octave }: { engine?: EngineControls; octave?: number }) {
  const playing = useStore((s) => s.transport.playing)
  const bpm = useStore((s) => s.transport.bpm)
  const step = useStore((s) => s.step)
  // The longer of the two tracks sets the song position's range.
  const steps = useStore((s) => Math.max(s.pattern.steps, s.drums.pattern.steps))
  useSpaceToPlay(engine)

  // One bar: "05/16". Longer: bar.step, "2.05/4" (bars).
  const multiBar = steps > BAR_STEPS
  const at = step < 0 ? -1 : step % steps
  const bar = Math.floor(at / BAR_STEPS) + 1
  const inBar = (at % BAR_STEPS) + 1
  const stepText = at < 0 ? (multiBar ? "-.--" : "--") : multiBar ? `${bar}.${String(inBar).padStart(2, "0")}` : String(at + 1).padStart(2, "0")
  const position = at < 0 ? "stopped" : multiBar ? `bar ${bar} step ${inBar}` : String(at + 1)
  return (
    <div data-osc-transport>
      <Button
        tone="primary"
        aria-label={playing ? "Stop" : "Play"}
        aria-pressed={playing}
        data-osc-play
        onClick={() => togglePlay(engine)}
      >
        <Icon name={playing ? "stop" : "play"} />
      </Button>
      <Lcd tag="SEQ" size="md" data-osc-lcd role="status" aria-label={`Tempo ${bpm} BPM, step ${position}`}>
        <div data-osc-lcd-row>
          <span data-osc-lcd-field>
            <LcdDigits value={String(Math.round(bpm)).padStart(3, " ")} ghost="888" />
            <small>BPM</small>
          </span>
          <span data-osc-lcd-field>
            <LcdDigits value={stepText} ghost={multiBar ? "8.88" : "88"} />
            <small>/{multiBar ? barsOf(steps) : steps}</small>
          </span>
          {octave !== undefined && (
            <span data-osc-lcd-field>
              <small>OCT</small>
              <LcdDigits value={String(octave)} ghost="8" />
            </span>
          )}
          <span data-osc-lcd-state>{playing ? "PLAY" : "STOP"}</span>
        </div>
      </Lcd>
      <div data-osc-tempo>
        <Knob
          label="Tempo"
          param="transport.bpm"
          legend="Tempo"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          value={bpm}
          resetValue={120}
          onValueChange={(next) => setTransport({ bpm: next })}
        />
        <ParamKnob
          param="master.volume"
          label="Master volume"
          legend="Volume"
          min={0}
          max={1}
          step={0.001}
          format={{ style: "percent", maximumFractionDigits: 0 }}
          color="blue"
          resetValue={0.7}
        />
      </div>
      <HistoryKeys />
    </div>
  )
}

/** Undo and Redo as keys too (the menubar and Ctrl+Z have them; the agent needs keys to press). */
function HistoryKeys() {
  // Re-render when history may have changed.
  useStore((s) => s.patch)
  useStore((s) => s.pattern)
  useStore((s) => s.drums)
  return (
    <div data-osc-history>
      <Button aria-label="Undo" disabled={!canUndo()} onClick={() => undo()}>
        <Icon name="undo" />
      </Button>
      <Button aria-label="Redo" disabled={!canRedo()} onClick={() => redo()}>
        <Icon name="redo" />
      </Button>
    </div>
  )
}
