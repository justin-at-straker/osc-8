import { Switch, SwitchThumb } from "@ui-sdk/react/switch"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs"
import { defaultKit, DRUM_LABELS, DRUM_SHORT, DRUM_VOICES, type DrumKit, type DrumVoice } from "@/engine/drums"
import { setKitValue, useStore } from "@/state/store"
import { haptic } from "@/lib/haptics"
import { Knob, type KnobProps } from "./knob"
import { selectVoice, useSelectedVoice } from "./drum-model"
import { formatPan } from "./taper"

const init = defaultKit()
const percent: Intl.NumberFormatOptions = { style: "percent", maximumFractionDigits: 0 }
const signed: Intl.NumberFormatOptions = { signDisplay: "exceptZero", maximumFractionDigits: 2 }

function readKit(kit: DrumKit, path: string): unknown {
  let node: unknown = kit
  for (const k of path.split(".")) node = (node as Record<string, unknown>)?.[k]
  return node
}

/** A knob bound to a kit field by path ("voices.kick.tune", "swing"). Drum knobs aren't mod targets. */
function KitKnob({ path, ...props }: { path: string } & Omit<KnobProps, "value" | "onValueChange" | "param" | "min" | "max"> & { min?: number; max?: number }) {
  const value = useStore((s) => readKit(s.drums.kit, path) as number)
  return (
    <Knob
      min={0}
      max={1}
      step={0.001}
      format={percent}
      {...props}
      param={`drums.${path}`}
      value={value}
      onValueChange={(next) => setKitValue(path, next)}
    />
  )
}

function MuteSwitch({ voice }: { voice: DrumVoice }) {
  const muted = useStore((s) => s.drums.kit.voices[voice].mute)
  return (
    <div data-param={`drums.voices.${voice}.mute`} data-osc-switch="compact">
      <span data-osc-legend data-osc-header-legend aria-hidden>
        Mute
      </span>
      <Switch
        data-kit="switch"
        aria-label={`${DRUM_LABELS[voice]} mute`}
        checked={muted}
        onCheckedChange={(next) => {
          haptic("selection")
          setKitValue(`voices.${voice}.mute`, next)
        }}
      >
        <SwitchThumb data-kit="switch-thumb" />
      </Switch>
    </div>
  )
}

function VoiceModule({ voice }: { voice: DrumVoice }) {
  const name = DRUM_LABELS[voice]
  const muted = useStore((s) => s.drums.kit.voices[voice].mute)
  const p = (field: string) => `voices.${voice}.${field}`
  const def = init.voices[voice]
  return (
    <section data-section data-osc-module data-osc-drum-voice aria-label={name}>
      <h2 data-osc-powered>
        {name}
        <MuteSwitch voice={voice} />
      </h2>
      <div data-osc-controls data-off={muted || undefined}>
        <KitKnob path={p("level")} label={`${name} level`} legend="Level" color="orange" resetValue={def.level} />
        <KitKnob path={p("tune")} label={`${name} tune`} legend="Tune" resetValue={def.tune} />
        <KitKnob path={p("decay")} label={`${name} decay`} legend="Decay" color="green" resetValue={def.decay} />
        <KitKnob path={p("tone")} label={`${name} tone`} legend="Tone" color="blue" resetValue={def.tone} />
        {/* Only the snare has snappy (its noise); other voices keep the place empty so nothing shifts. */}
        {voice === "snare" ? (
          <KitKnob path={p("snappy")} label={`${name} snappy`} legend="Snappy" color="green" resetValue={def.snappy} />
        ) : (
          <span data-osc-knob-blank aria-hidden />
        )}
        <KitKnob path={p("pan")} label={`${name} pan`} legend="Pan" min={-1} max={1} step={0.01} format={signed} displayValue={formatPan} resetValue={def.pan} />
      </div>
    </section>
  )
}

/**
 * The DRUM page: eleven voice keys (the selection is shared with the grid's
 * row labels), the selected voice's controls, and the drum bus. Every voice's
 * controls stay mounted so the UI SDK agent can reach "Snare snappy" from anywhere.
 */
export function DrumPanel() {
  const selected = useSelectedVoice()
  return (
    <Tabs data-osc-panel data-osc-drum-page value={selected} onValueChange={(next: unknown) => selectVoice(next as DrumVoice)}>
      <section data-section data-osc-module data-osc-drum-keys aria-label="Drum voices">
        <h2>Voice</h2>
        <TabsList data-osc-voice-keys aria-label="Drum voice">
          {DRUM_VOICES.map((voice) => (
            <TabsTab key={voice} value={voice} data-osc-voice-key aria-label={DRUM_LABELS[voice]}>
              {DRUM_SHORT[voice]}
              <VoiceLed voice={voice} />
            </TabsTab>
          ))}
        </TabsList>
      </section>
      <div data-osc-drum-voices>
        {DRUM_VOICES.map((voice) => (
          <TabsPanel key={voice} value={voice} keepMounted data-osc-subpanel>
            <VoiceModule voice={voice} />
          </TabsPanel>
        ))}
      </div>
      <section data-section data-osc-module aria-label="Drum bus">
        <h2>Bus</h2>
        <div data-osc-controls>
          <KitKnob path="accent" label="Drum accent" legend="Accent" color="orange" resetValue={init.accent} />
          <KitKnob path="level" label="Drum bus level" legend="Level" resetValue={init.level} />
          <KitKnob path="drive" label="Drum bus drive" legend="Drive" color="orange" resetValue={init.drive} />
          <KitKnob path="swing" label="Drum swing" legend="Swing" color="green" resetValue={init.swing} />
        </div>
      </section>
    </Tabs>
  )
}

/** A voice key's LED: lit unless the voice is muted. */
function VoiceLed({ voice }: { voice: DrumVoice }) {
  const muted = useStore((s) => s.drums.kit.voices[voice].mute)
  return <i data-osc-ab-led data-on={!muted || undefined} aria-hidden />
}
