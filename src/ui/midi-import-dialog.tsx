import * as React from "react"
import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox"
import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/react/dialog"
import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/react/segmented-control"
import { Button } from "@/components/ui/button"
import { Lcd } from "@/components/ui/lcd"
import { applyImport } from "@/midi/apply"
import { BAR_CHOICES, contentBars, convert, defaultSelection, describe, DRUM_CHANNEL, quantize } from "@/midi/convert"
import { closeMidiImport, useMidiImportFile } from "@/midi/open"
import { parseSmf, type Smf } from "@/midi/smf"
import { StepperControl } from "./controls"

async function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file."))
    reader.readAsArrayBuffer(file)
  })
}

type Loaded = { file: File; smf: Smf } | { file: File; error: string } | null

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <Checkbox data-kit="checkbox" aria-label={label} checked={checked} onCheckedChange={(next) => onChange(next === true)}>
      <CheckboxIndicator data-kit="checkbox-indicator">✓</CheckboxIndicator>
    </Checkbox>
  )
}

const toggle = (list: number[], i: number, on: boolean) => (on ? [...new Set([...list, i])] : list.filter((x) => x !== i))

/**
 * File > Import MIDI…, or a .mid dropped on the page: pick tracks, a window of
 * bars and the tempo, then import into the synth roll and the 808 as one undo step.
 */
export function MidiImportDialog() {
  const file = useMidiImportFile()
  const [loaded, setLoaded] = React.useState<Loaded>(null)

  React.useEffect(() => {
    if (!file) return
    let live = true
    readBytes(file)
      .then((bytes) => live && setLoaded({ file, smf: parseSmf(bytes) }))
      .catch((error: unknown) => live && setLoaded({ file, error: error instanceof Error ? error.message : String(error) }))
    return () => {
      live = false
    }
  }, [file])

  const current = loaded && loaded.file === file ? loaded : null
  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && closeMidiImport()}>
      <DialogBackdrop data-kit="backdrop" />
      <DialogContent data-kit="dialog" data-osc-midi-dialog>
        <div data-kit="dialog-surface" style={{ display: "grid", gap: 14 }}>
          <DialogTitle data-kit="dialog-title">Import MIDI</DialogTitle>
          <DialogDescription data-kit="dialog-description">
            {file ? file.name : ""}
            {current && "smf" in current && (
              <>
                {" · "}format {current.smf.format}, {current.smf.tracks.length} track{current.smf.tracks.length === 1 ? "" : "s"}
                {current.smf.bpm ? `, ${Math.round(current.smf.bpm * 10) / 10} BPM` : ""}
              </>
            )}
          </DialogDescription>
          {!current ? (
            <Lcd tag="MIDI" size="sm" role="status">
              Reading…
            </Lcd>
          ) : "error" in current ? (
            <>
              <Lcd tag="MIDI" size="sm" role="alert" data-tone="error">
                {current.error}
              </Lcd>
              <div data-kit="actions">
                <DialogClose data-kit="button" data-tone="secondary">
                  Close
                </DialogClose>
              </div>
            </>
          ) : (
            <ImportForm key={current.file.name + current.file.size} smf={current.smf} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ImportForm({ smf }: { smf: Smf }) {
  const initial = React.useMemo(() => defaultSelection(smf), [smf])
  const [melodic, setMelodic] = React.useState(initial.melodicTracks)
  const [drums, setDrums] = React.useState(initial.drumTracks)
  const [startBar, setStartBar] = React.useState<number | null>(null)
  const [bars, setBars] = React.useState<number | null>(null)
  const [setTempo, setSetTempo] = React.useState(smf.bpm !== null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const totalBars = React.useMemo(() => {
    const all = quantize(smf.tracks.flatMap((t) => t.notes), smf.ppq)
    const { firstBar, barCount } = contentBars(all)
    return Math.max(1, firstBar + barCount)
  }, [smf])
  const result = React.useMemo(
    () => convert(smf, { melodicTracks: melodic, drumTracks: drums, startBar: startBar ?? undefined, bars: bars ?? undefined }),
    [smf, melodic, drums, startBar, bars]
  )
  const nothing = melodic.length === 0 && drums.length === 0

  const onImport = async () => {
    setBusy(true)
    try {
      await applyImport(result, { setTempo })
      closeMidiImport()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const tracks = smf.tracks.filter((t) => t.notes.length > 0)
  return (
    <>
      <div data-osc-midi-tracks role="group" aria-label="Tracks">
        <div data-osc-midi-head aria-hidden>
          <span>Synth</span>
          <span>808</span>
          <span>Track</span>
          <span>Channels</span>
          <span>Notes</span>
        </div>
        {tracks.length === 0 && <p data-osc-midi-empty>This file has no notes.</p>}
        {tracks.map((t) => {
          const name = t.name || `Track ${t.index + 1}`
          const hasMelodic = t.notes.some((n) => n.channel !== DRUM_CHANNEL)
          const hasDrums = t.channels.includes(DRUM_CHANNEL)
          return (
            <div key={t.index} data-osc-midi-track>
              <span>{hasMelodic && <Check label={`Import ${name} to the synth`} checked={melodic.includes(t.index)} onChange={(on) => setMelodic((l) => toggle(l, t.index, on))} />}</span>
              <span>{hasDrums && <Check label={`Import ${name} drums to the 808`} checked={drums.includes(t.index)} onChange={(on) => setDrums((l) => toggle(l, t.index, on))} />}</span>
              <span data-osc-midi-name>{name}</span>
              <span>{t.channels.map((c) => (c === DRUM_CHANNEL ? "10 (drums)" : String(c + 1))).join(", ")}</span>
              <span>{t.notes.length}</span>
            </div>
          )
        })}
      </div>

      <div data-osc-midi-options>
        <StepperControl label="Start bar" legend="Start bar" value={result.startBar + 1} min={1} max={totalBars} onValueChange={(v) => setStartBar(v - 1)} />
        <div data-osc-keyrow>
          <span data-osc-keyrow-legend aria-hidden>
            Bars
          </span>
          <SegmentedControl
            data-osc-keys
            aria-label="Bars to import"
            value={bars === null ? "auto" : String(bars)}
            onValueChange={(next) => next && setBars(next === "auto" ? null : Number(next))}
          >
            <SegmentedControlItem value="auto" data-osc-key aria-label="Fit">
              Fit
            </SegmentedControlItem>
            {BAR_CHOICES.map((b) => (
              <SegmentedControlItem key={b} value={String(b)} data-osc-key aria-label={`${b} bar${b > 1 ? "s" : ""}`}>
                {b}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
        {result.bpm !== null && (
          <label data-osc-midi-tempo>
            <Check label={`Set tempo to ${result.bpm} BPM`} checked={setTempo} onChange={setSetTempo} />
            <span aria-hidden>Set tempo to {result.bpm} BPM</span>
          </label>
        )}
      </div>

      <Lcd tag="IMPORT" size="sm" role="status" aria-live="polite" data-osc-midi-summary>
        {error ?? (nothing ? "Choose at least one track." : describe(result))}
      </Lcd>

      <div data-kit="actions">
        <DialogClose data-kit="button" data-tone="secondary">
          Cancel
        </DialogClose>
        <Button tone="primary" onClick={onImport} disabled={nothing || busy}>
          Import
        </Button>
      </div>
    </>
  )
}
