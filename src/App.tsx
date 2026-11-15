import { Hardware } from "@/components/ui/hardware"
import { MidiEditor } from "@/components/blocks/midi-editor/midi-editor"

export function App() {
  return (
    <Hardware keyColor={{ l: 0.64, c: 0.31, h: 48 }}>
      <MidiEditor />
    </Hardware>
  )
}
