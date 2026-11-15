import * as React from "react"
import { isMidiFile, openMidiImport } from "@/midi/open"

const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files")

/** A .mid dropped anywhere on the page opens the Import MIDI dialog. True while a file is dragged over. */
export function useMidiDrop() {
  const [over, setOver] = React.useState(false)
  React.useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setOver(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const dragover = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    }
    const drop = (e: DragEvent) => {
      depth = 0
      setOver(false)
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      e.preventDefault()
      if (isMidiFile(file)) openMidiImport(file)
    }
    window.addEventListener("dragenter", enter)
    window.addEventListener("dragleave", leave)
    window.addEventListener("dragover", dragover)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragenter", enter)
      window.removeEventListener("dragleave", leave)
      window.removeEventListener("dragover", dragover)
      window.removeEventListener("drop", drop)
    }
  }, [])
  return over
}
