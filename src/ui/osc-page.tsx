import * as React from "react"
import type { ReactNode } from "react"
import { useStore } from "@/state/store"
import { Device, DevicePlate } from "@/components/ui/device"
import { AudioGate } from "./audio-gate"
import { PianoRoll } from "./piano-roll"
import { FrontPanel, type FrontPage } from "./front-panel"
import { DrumGrid } from "./drum-grid"
import type { Track } from "./drum-model"
import { TrackSwitch } from "./track-switch"
import { MidiImportDialog } from "./midi-import-dialog"
import { useMidiDrop } from "./use-midi-drop"
import { usePairZoom } from "./use-pair-zoom"
import { useAgentGlow } from "./use-agent-glow"
import { PresetBrowser } from "./preset-browser"
import { ModSourceStrip } from "./mod-ui"
import { Transport } from "./transport"
import { useQwertyKeyboard } from "./use-qwerty-keyboard"
import type { EngineControls } from "./types"
import "./osc.css"
import "./mod.css"
import "./synth.css"
import "./drums.css"
import "./paging.css"
import "./midi.css"
import "./ai-module.css"

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
  /** The AI module (DescribeField): shown as its own device, AI-1, to the right of the instrument. Hidden from the UI SDK agent. */
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
  const [track, setTrack] = React.useState<Track>("synth")
  const [page, setPage] = React.useState<FrontPage>("synth")
  // Switching track follows with the front panel (808 -> DRUM, SYNTH -> SYNTH),
  // only at the moment of switching; a page picked by hand stays put otherwise.
  const chooseTrack = (next: Track) => {
    if (next === track) return
    setTrack(next)
    if (next === "808") setPage("drum")
    else if (page === "drum") setPage("synth")
  }
  const trackSwitch = <TrackSwitch track={track} onTrackChange={chooseTrack} />
  const dropping = useMidiDrop()
  const { pageRef, pairRef } = usePairZoom()
  useAgentGlow()

  return (
    <main data-osc-page data-dropping={dropping || undefined} ref={pageRef}>
      {/* The instrument and the AI-1 beside it, scaled together to fit the window. */}
      <div data-osc-pair ref={pairRef}>
      <div data-osc-pair-slot data-osc-instrument>
      <Device model="OSC-8" name="Wavetable synth" plate="none">
        <div data-osc-header>
          <DevicePlate model="OSC-8" name="Wavetable synth" on={audio === "on" && playing} />
          <PresetBrowser />
          {menubar}
        </div>
        <div data-osc-top>
          <Transport engine={engine} octave={octave} />
        </div>
        <FrontPanel page={page} onPageChange={setPage} />
        {track === "synth" ? (
          <PianoRoll barSlot={<ModSourceStrip />} trackSlot={trackSwitch} />
        ) : (
          <DrumGrid engine={engine} barSlot={<ModSourceStrip />} trackSlot={trackSwitch} />
        )}
        {showHints && (
          <p data-osc-hint aria-hidden>
            A-K play · Z/X octave · Space play · Ctrl+Z undo · drag a note to lengthen
          </p>
        )}
      </Device>
      </div>
      {aiSlot && (
        <div data-osc-pair-slot data-osc-ai-device>
          <Device model="AI-1" name="Sound agent" plate="none">
            {/* The whole AI device is hidden from the UI SDK agent: it can't type into its own prompt. */}
            <div data-agent-hidden data-osc-ai-body>
              {aiSlot}
            </div>
          </Device>
        </div>
      )}
      </div>
      {audioGate && <AudioGate engine={engine} />}
      <MidiImportDialog />
    </main>
  )
}
