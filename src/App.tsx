import { useEffect, useMemo, useState } from "react"
import { getState, resetHistory, setDrumPattern, setPattern, setTransport } from "@/state/store"
import { DEMO_DRUMS } from "@/engine/drums"
import { Hardware } from "@/components/ui/hardware"
import { Toasts, notify } from "@/components/ui/toaster"
import { DescribeField, KeySettings } from "@/ai"
import { EngineClient } from "@/engine/client"
import { startAudio } from "@/engine/bridge"
import { connectLiveMod } from "@/engine/live-mod"
import { AppMenubar, DEFAULT_PRESET_ID, DEMO_BPM, DEMO_PATTERN, OscPage, loadPresetById, type EngineControls } from "@/ui"

const client = new EngineClient()
connectLiveMod()

// Start on a warm keys sound playing a familiar melody, with a clean undo history.
loadPresetById(DEFAULT_PRESET_ID)
setPattern(DEMO_PATTERN, "load")
setDrumPattern(DEMO_DRUMS, "load")
setTransport({ bpm: DEMO_BPM })
resetHistory()

export function App() {
  const [keysOpen, setKeysOpen] = useState(false)
  const [showHints, setShowHints] = useState(true)
  const engine = useMemo<EngineControls>(
    () => ({
      start: async () => {
        await startAudio(client)
      },
      noteOn: (note, velocity) => client.noteOn(note, velocity),
      noteOff: (note) => client.noteOff(note),
      triggerDrum: (voice, velocity) => client.triggerDrum(voice, velocity),
    }),
    []
  )
  // No start screen: browsers only allow audio after a user gesture, so the
  // first click or keypress anywhere starts it (capture phase, before the
  // control that was pressed handles it).
  useEffect(() => {
    const start = () => {
      if (getState().audio === "off") void engine.start().catch(() => {})
    }
    const opts = { capture: true, once: true } as const
    window.addEventListener("pointerdown", start, opts)
    window.addEventListener("keydown", start, opts)
    return () => {
      window.removeEventListener("pointerdown", start, opts)
      window.removeEventListener("keydown", start, opts)
    }
  }, [engine])

  return (
    <Hardware keyColor={{ l: 0.64, c: 0.31, h: 48 }}>
      <OscPage
        engine={engine}
        audioGate={false}
        showHints={showHints}
        menubar={
          <AppMenubar
            engine={engine}
            onOpenKeys={() => setKeysOpen(true)}
            onError={(message) => notify({ title: "Couldn't import patch", description: message })}
            showHints={showHints}
            onShowHintsChange={setShowHints}
          />
        }
        aiSlot={<DescribeField />}
      />
      <KeySettings open={keysOpen} onOpenChange={setKeysOpen} />
      <Toasts />
    </Hardware>
  )
}
