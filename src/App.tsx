import { useMemo } from "react"
import { Hardware } from "@/components/ui/hardware"
import { DescribeField } from "@/ai"
import { EngineClient } from "@/engine/client"
import { startAudio } from "@/engine/bridge"
import { OscPage, type EngineControls } from "@/ui"

const client = new EngineClient()

export function App() {
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
  return (
    <Hardware keyColor={{ l: 0.64, c: 0.31, h: 48 }}>
      <OscPage engine={engine} aiSlot={<DescribeField />} />
    </Hardware>
  )
}
