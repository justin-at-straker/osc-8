import type { ReactNode } from "react"
import { useStore } from "@/state/store"
import { Device } from "@/components/ui/device"
import { AudioGate } from "./audio-gate"
import { PianoRoll } from "./piano-roll"
import { SynthPanel } from "./synth-panel"
import { Transport } from "./transport"
import { useQwertyKeyboard } from "./use-qwerty-keyboard"
import type { EngineControls } from "./types"
import "./osc.css"

/**
 * The M1 instrument: one device with the transport and the AI slot across the
 * top, the synth front panel, then the piano roll on its screen. Desktop
 * width (>= 1280px); narrower windows zoom the device down, as SPEC-01 does.
 */
export function OscPage({
  engine,
  aiSlot,
  audioGate = true,
}: {
  engine: EngineControls
  /** Rendered top right, beside the transport: the place for the AI describe field. */
  aiSlot?: ReactNode
  /** Render the "tap to start audio" overlay. Pass false if the app renders its own <AudioGate>. */
  audioGate?: boolean
}) {
  const audio = useStore((s) => s.audio)
  const playing = useStore((s) => s.transport.playing)
  const { octave } = useQwertyKeyboard(engine)

  return (
    <main data-osc-page>
      <Device model="OSC-8" name="Wavetable synth" on={audio === "on" && playing}>
        <div data-osc-top>
          <Transport engine={engine} octave={octave} />
          <div data-osc-ai-slot>{aiSlot}</div>
        </div>
        <SynthPanel />
        <PianoRoll />
        <p data-osc-hint aria-hidden>
          A-K play · Z/X octave · Space play · Ctrl+Z undo · drag a note to lengthen
        </p>
      </Device>
      {audioGate && <AudioGate engine={engine} />}
    </main>
  )
}
