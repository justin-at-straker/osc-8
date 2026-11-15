import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { defaultKit } from "@/engine/drums"
import { defaultPatch } from "@/engine/patch"
import { smf, notesTrack, tempo, track, trackName } from "@/midi/build-smf"
import { closeMidiImport, openMidiImport } from "@/midi/open"
import { editKit, endGesture, getState, replacePatch, setDrumPattern, setPattern, setTransport, undo } from "@/state/store"
import { MidiImportDialog } from "./midi-import-dialog"

const PPQ = 96

function file(bytes: Uint8Array, name = "song.mid") {
  return new File([bytes.slice().buffer], name, { type: "audio/midi" })
}

const song = () =>
  smf(1, PPQ, [
    track([[0, ...trackName("Tempo")], [0, ...tempo(124)]]),
    notesTrack("Bass", 0, [[0, 24, 28, 100], [48, 24, 31, 100], [96, 24, 33, 100]]),
    notesTrack("Pad", 1, [[0, 96, 60, 80]]),
    notesTrack("Drums", 9, [[0, 12, 36, 120], [96, 12, 38, 100], [0, 12, 42, 80], [48, 12, 42, 80]]),
  ])

beforeEach(() => {
  act(() => {
    closeMidiImport()
    replacePatch(defaultPatch(), "load")
    setPattern({ steps: 16, notes: [{ step: 3, note: 60, length: 1, velocity: 0.8 }] }, "load")
    setDrumPattern({ steps: 16, hits: [] }, "load")
    editKit(defaultKit(), "load")
    setTransport({ bpm: 120 })
    endGesture()
  })
})

describe("Import MIDI dialog", () => {
  it("lists tracks with the busiest melodic track and the drums preselected, and imports as one undo step", async () => {
    render(<MidiImportDialog />)
    act(() => openMidiImport(file(song())))
    await screen.findByText("Bass")
    expect(screen.getByText("Pad")).toBeTruthy()
    expect(screen.getByRole("checkbox", { name: "Import Bass to the synth" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByRole("checkbox", { name: "Import Pad to the synth" }).getAttribute("aria-checked")).toBe("false")
    expect(screen.getByRole("checkbox", { name: "Import Drums drums to the 808" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByRole("status").textContent).toContain("3 notes, shifted +24, osc A octave -2, 4 drum hits")

    const before = { pattern: getState().pattern, drums: getState().drums.pattern, octave: getState().patch.oscA.octave }
    fireEvent.click(screen.getByRole("checkbox", { name: "Set tempo to 124 BPM" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Set tempo to 124 BPM" }))
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    await waitFor(() => expect(getState().pattern.notes.map((n) => n.note)).toEqual([52, 55, 57]))
    expect(getState().drums.pattern.hits).toHaveLength(4)
    expect(getState().patch.oscA.octave).toBe(-2)
    expect(getState().transport.bpm).toBe(124)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    act(() => undo())
    expect(getState().pattern).toEqual(before.pattern)
    expect(getState().drums.pattern).toEqual(before.drums)
    expect(getState().patch.oscA.octave).toBe(before.octave)
  })

  it("updates the readout as the selection and bars change", async () => {
    render(<MidiImportDialog />)
    act(() => openMidiImport(file(song())))
    await screen.findByText("Bass")
    fireEvent.click(screen.getByRole("checkbox", { name: "Import Bass to the synth" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Import Pad to the synth" }))
    expect(screen.getByRole("status").textContent).toContain("1 note,")
    fireEvent.click(screen.getByRole("radio", { name: "4 bars" }))
    expect(screen.getByRole("status").textContent).toContain("4 bars (64 steps) from bar 1")
    fireEvent.click(screen.getByRole("checkbox", { name: "Import Pad to the synth" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Import Drums drums to the 808" }))
    expect(screen.getByRole("status").textContent).toBe("IMPORTChoose at least one track.")
    expect(screen.getByRole("button", { name: "Import" }).hasAttribute("disabled")).toBe(true)
  })

  it("shows a malformed file's error inline", async () => {
    render(<MidiImportDialog />)
    act(() => openMidiImport(file(new TextEncoder().encode("not a midi file at all"), "broken.mid")))
    expect((await screen.findByRole("alert")).textContent).toContain("isn't a Standard MIDI File")
  })
})
