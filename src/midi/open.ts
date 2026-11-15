// Opening the Import MIDI dialog from anywhere (the File menu, a dropped file).
import { useSyncExternalStore } from "react"

let pending: File | null = null
const listeners = new Set<() => void>()
function set(file: File | null) {
  pending = file
  for (const l of listeners) l()
}

/** Show the import dialog for this file. */
export const openMidiImport = (file: File) => set(file)
export const closeMidiImport = () => set(null)

export function useMidiImportFile(): File | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pending
  )
}

export const isMidiFile = (file: File) => /\.(mid|midi|smf|kar)$/i.test(file.name) || file.type === "audio/midi" || file.type === "audio/x-midi"

/** Ask for a .mid file with the browser's picker, then open the dialog. */
export function pickMidiFile() {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".mid,.midi,audio/midi,audio/x-midi"
  // In the document while the picker is open: some browsers ignore a detached input.
  input.hidden = true
  input.onchange = () => {
    const file = input.files?.[0]
    input.remove()
    if (file) openMidiImport(file)
  }
  input.oncancel = () => input.remove()
  document.body.append(input)
  input.click()
}
