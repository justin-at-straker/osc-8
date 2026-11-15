import { useEffect, useMemo, useState } from "react"
import { getState } from "@/state/store"
import { Hardware } from "@/components/ui/hardware"
import { Toasts, notify } from "@/components/ui/toaster"
import { DescribeField, KeySettings } from "@/ai"
import { EngineClient } from "@/engine/client"
import { startAudio } from "@/engine/bridge"
import { AppMenubar, OscPage, type EngineControls } from "@/ui"

const client = new EngineClient()

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
