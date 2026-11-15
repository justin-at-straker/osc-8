import type { ReactNode } from "react"
import { useStore } from "@/state/store"
import { Device, DevicePlate } from "@/components/ui/device"
import { AudioGate } from "./audio-gate"
import { PianoRoll } from "./piano-roll"
import { FrontPanel } from "./front-panel"
import { PresetBrowser } from "./preset-browser"
import { ModSourceStrip } from "./mod-ui"
import { Transport } from "./transport"
import { useQwertyKeyboard } from "./use-qwerty-keyboard"
import type { EngineControls } from "./types"
import "./osc.css"
import "./mod.css"

/**
 * The M1 instrument: one device with the transport and the AI slot across the
 * top, the synth front panel, then the piano roll on its screen. Desktop
 * width (>= 1280px); narrower windows zoom the device down, as SPEC-01 does.
 */
export function OscPage({
  engine,
  aiSlot,
  menubar,
  showHints = true,
  audioGate = true,
}: {
  engine: EngineControls
  /** Rendered top right, beside the transport: the place for the AI describe field. */
  aiSlot?: ReactNode
  /** Rendered in the device's top strip, beside the maker's plate. */
  menubar?: ReactNode
  /** Show the key hints line under the roll. */
  showHints?: boolean
  /** Render the "tap to start audio" overlay. Pass false if the app renders its own <AudioGate>. */
  audioGate?: boolean
}) {
  const audio = useStore((s) => s.audio)
  const playing = useStore((s) => s.transport.playing)
  const { octave } = useQwertyKeyboard(engine)

  return (
    <main data-osc-page>
      <Device model="OSC-8" name="Wavetable synth" plate="none">
        <div data-osc-header>
          <DevicePlate model="OSC-8" name="Wavetable synth" on={audio === "on" && playing} />
          <PresetBrowser />
          {menubar}
        </div>
        <div data-osc-top>
          <Transport engine={engine} octave={octave} />
          <div data-osc-ai-slot>{aiSlot}</div>
        </div>
        <FrontPanel />
        <PianoRoll barSlot={<ModSourceStrip />} />
        {showHints && (
          <p data-osc-hint aria-hidden>
            A-K play · Z/X octave · Space play · Ctrl+Z undo · drag a note to lengthen
          </p>
        )}
      </Device>
      {audioGate && <AudioGate engine={engine} />}
    </main>
  )
}
