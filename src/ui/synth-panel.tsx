import * as React from "react"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs"
import { BUILTIN_TABLES, defaultPatch } from "@/engine/patch"
import { formatColor, formatPan, LOG, power } from "./taper"
import { ParamDial, ParamKnob, ParamSlide, ParamStepper, ParamSwitch } from "./controls"
import { usePatchValue, writePatchValue } from "./use-patch"
import { SlideSwitch } from "@/components/ui/slide-switch"
import { editPatch } from "@/state/store"
import { Module } from "./module"

const init = defaultPatch()

const TABLE_LABELS: Record<(typeof BUILTIN_TABLES)[number], string> = {
  basic: "Basic",
  pwm: "PWM",
  "harmonic-sweep": "Harm",
  formant: "Formant",
  digital: "Digital",
}

const percent: Intl.NumberFormatOptions = { style: "percent", maximumFractionDigits: 0 }
const seconds: Intl.NumberFormatOptions = { style: "unit", unit: "second", unitDisplay: "narrow", maximumSignificantDigits: 2 }
const hertz: Intl.NumberFormatOptions = { notation: "compact", maximumSignificantDigits: 3 }
const cents: Intl.NumberFormatOptions = { signDisplay: "exceptZero", maximumFractionDigits: 0 }
const signed: Intl.NumberFormatOptions = { signDisplay: "exceptZero", maximumFractionDigits: 2 }
const unit = { min: 0, max: 1, step: 0.001, format: percent }

type OscKey = "oscA" | "oscB"
const OSC_NAME: Record<OscKey, string> = { oscA: "Osc A", oscB: "Osc B" }

function TableDial({ osc }: { osc: OscKey }) {
  const table = usePatchValue<{ kind: string; name?: string }>(`${osc}.table`)
  const current = table.kind === "builtin" && table.name ? table.name : ""
  return (
    <ParamDial
      param={`${osc}.table`}
      label={`${OSC_NAME[osc]} table`}
      value={current}
      options={BUILTIN_TABLES.map((name) => ({ value: name, label: TABLE_LABELS[name] }))}
      onChange={(name) => writePatchValue(`${osc}.table`, { kind: "builtin", name })}
    />
  )
}

/** A row of 16 LEDs, one lit per unison voice, and "x7": how thick the stack is, at a glance. */
function UnisonLeds({ osc }: { osc: OscKey }) {
  const voices = usePatchValue<number>(`${osc}.unison`)
  return (
    <span data-osc-unison-leds aria-hidden>
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} data-on={i < voices || undefined} />
      ))}
      <b>x{voices}</b>
    </span>
  )
}

/** One oscillator's controls, with its power and "to filter" switches in the header. */
function OscBody({ osc }: { osc: OscKey }) {
  const name = OSC_NAME[osc]
  const p = (field: string) => `${osc}.${field}`
  const def = init[osc]
  return (
    <section data-section data-osc-module data-osc-oscbody aria-label={name}>
      <h2 data-osc-powered>
        {name}
        <UnisonLeds osc={osc} />
        <span data-osc-legend data-osc-header-legend aria-hidden>
          → Filter
        </span>
        <ParamSwitch param={p("toFilter")} label={`${name} to filter`} compact />
        <ParamSwitch param={p("enabled")} label={`${name} enabled`} compact />
      </h2>
      <OscControls osc={osc} name={name} def={def} p={p} />
    </section>
  )
}

function OscControls({ osc, name, def, p }: { osc: OscKey; name: string; def: (typeof init)[OscKey]; p: (field: string) => string }) {
  const on = usePatchValue<boolean>(p("enabled"))
  return (
    <div data-osc-controls data-off={!on || undefined}>
      <TableDial osc={osc} />
      <ParamKnob param={p("position")} label={`${name} position`} legend="WT Pos" {...unit} color="orange" resetValue={def.position} />
      <ParamKnob param={p("level")} label={`${name} level`} legend="Level" {...unit} resetValue={def.level} />
      <div data-osc-stack>
        <ParamStepper param={p("octave")} label={`${name} octave`} legend="Oct" min={-4} max={4} signed />
        <ParamStepper param={p("semi")} label={`${name} semitone`} legend="Semi" min={-12} max={12} signed />
      </div>
      <ParamKnob param={p("fine")} label={`${name} fine tune`} legend="Fine" min={-100} max={100} step={1} format={cents} resetValue={0} />
      <ParamKnob param={p("pan")} label={`${name} pan`} legend="Pan" min={-1} max={1} step={0.01} format={signed} displayValue={formatPan} resetValue={0} />
      <div data-osc-group>
        <ParamKnob
          param={p("unison")}
          label={`${name} unison`}
          legend="Voices"
          min={1}
          max={16}
          step={1}
          format={{ maximumFractionDigits: 0 }}
          color="green"
          resetValue={1}
        />
        <ParamKnob param={p("detune")} label={`${name} detune`} legend="Detune" {...unit} color="green" resetValue={def.detune} />
        <ParamKnob param={p("blend")} label={`${name} blend`} legend="Blend" {...unit} color="green" resetValue={def.blend} />
        <ParamKnob param={p("spread")} label={`${name} spread`} legend="Spread" {...unit} color="green" resetValue={def.spread} />
      </div>
      <div data-osc-small>
        <ParamKnob param={p("phase")} label={`${name} phase`} legend="Phase" {...unit} resetValue={def.phase} />
        <ParamKnob param={p("randomPhase")} label={`${name} random phase`} legend="Rand" {...unit} resetValue={def.randomPhase} />
      </div>
    </div>
  )
}

/**
 * Osc A and Osc B share one place on the panel: lettered keys down its left
 * edge pick which one shows (both stay mounted for the agent; resting on a
 * key while dragging a mod handle opens it). Each key's LED shows its osc is on.
 */
function Oscillators() {
  const [which, setWhich] = React.useState<OscKey>("oscA")
  const aOn = usePatchValue<boolean>("oscA.enabled")
  const bOn = usePatchValue<boolean>("oscB.enabled")
  return (
    <Tabs data-osc-oscs orientation="vertical" value={which} onValueChange={(next: unknown) => setWhich(next as OscKey)}>
      <TabsList data-osc-ab aria-label="Oscillator">
        <TabsTab value="oscA" data-osc-ab-key aria-label="Oscillator A">
          A<i data-osc-ab-led data-on={aOn || undefined} aria-hidden />
        </TabsTab>
        <TabsTab value="oscB" data-osc-ab-key aria-label="Oscillator B">
          B<i data-osc-ab-led data-on={bOn || undefined} aria-hidden />
        </TabsTab>
      </TabsList>
      <TabsPanel value="oscA" keepMounted data-osc-subpanel>
        <OscBody osc="oscA" />
      </TabsPanel>
      <TabsPanel value="oscB" keepMounted data-osc-subpanel>
        <OscBody osc="oscB" />
      </TabsPanel>
    </Tabs>
  )
}

export type SynthPage = "osc" | "layers" | "filter"

/**
 * The SYNTH page: two sub-pages behind small keys. OSC (the default) holds the
 * oscillators and the filter, the knobs turned most; SUB/AMP holds the sub,
 * noise and amp envelope. Master volume lives in the transport strip.
 */
const GLIDE_MODES = ["Off", "Always", "Legato"] as const
type GlideMode = (typeof GLIDE_MODES)[number]

/**
 * One switch over two patch fields: Off is poly; Always and Legato are mono,
 * with voicing.legato choosing whether every note glides or only overlapping
 * (and touching) ones.
 */
function GlideModeSwitch() {
  const mode = usePatchValue<"poly" | "mono">("voicing.mode")
  const legato = usePatchValue<boolean>("voicing.legato")
  const value: GlideMode = mode === "poly" ? "Off" : legato ? "Legato" : "Always"
  return (
    <div data-param="voicing.mode" data-osc-slide>
      <SlideSwitch
        label="Glide mode"
        options={[...GLIDE_MODES]}
        value={value}
        orientation="vertical"
        onValueChange={(next) => {
          const m = next as GlideMode
          editPatch({ voicing: { mode: m === "Off" ? "poly" : "mono", legato: m === "Legato" } })
        }}
      />
    </div>
  )
}

export function SynthPanel() {
  const [page, setPage] = React.useState<SynthPage>("osc")
  return (
    <Tabs data-osc-mod data-osc-synth orientation="vertical" value={page} onValueChange={(next: unknown) => setPage(next as SynthPage)}>
      <TabsList data-osc-subtabs aria-label="Synth pages">
        <TabsTab value="osc" data-osc-subtab aria-label="Oscillators">
          Osc
        </TabsTab>
        <TabsTab value="layers" data-osc-subtab aria-label="Sub, noise and amp envelope">
          Sub·Amp
        </TabsTab>
        <TabsTab value="filter" data-osc-subtab aria-label="Filter and voice">
          Filter
        </TabsTab>
      </TabsList>
      <TabsPanel value="osc" keepMounted data-osc-subpanel>
        <div data-osc-panel data-osc-synth-osc>
          <Oscillators />
        </div>
      </TabsPanel>
      <TabsPanel value="layers" keepMounted data-osc-subpanel>
        <div data-osc-panel data-osc-synth-layers>
          <Module title="Sub" power={{ param: "sub.enabled", label: "Sub enabled" }}>
            <ParamKnob param="sub.level" label="Sub level" legend="Level" {...unit} color="orange" resetValue={init.sub.level} />
            <ParamSlide param="sub.octave" label="Sub octave" options={["0", "-1", "-2"]} numeric />
            <ParamSlide param="sub.shape" label="Sub shape" options={["sine", "triangle", "square"]} />
          </Module>
          <Module title="Noise" power={{ param: "noise.enabled", label: "Noise enabled" }}>
            <ParamKnob param="noise.level" label="Noise level" legend="Level" {...unit} resetValue={init.noise.level} />
            <ParamKnob param="noise.color" label="Noise color" legend="Color" {...unit} displayValue={formatColor} color="orange" resetValue={init.noise.color} />
            <ParamSwitch param="noise.toFilter" label="Noise to filter" legend="→ Filter" />
          </Module>
          <Module title="Amp Env">
            <ParamKnob param="env1.attack" label="Amp attack" legend="Attack" min={0} max={20} step={0.001} taper={power(4)} format={seconds} color="green" resetValue={init.env1.attack} />
            <ParamKnob param="env1.decay" label="Amp decay" legend="Decay" min={0} max={20} step={0.001} taper={power(4)} format={seconds} color="green" resetValue={init.env1.decay} />
            <ParamKnob param="env1.sustain" label="Amp sustain" legend="Sustain" {...unit} color="green" resetValue={init.env1.sustain} />
            <ParamKnob param="env1.release" label="Amp release" legend="Release" min={0} max={20} step={0.001} taper={power(4)} format={seconds} color="green" resetValue={init.env1.release} />
          </Module>
        </div>
      </TabsPanel>
      <TabsPanel value="filter" keepMounted data-osc-subpanel>
        <div data-osc-panel data-osc-synth-filter>
          <Module title="Filter" power={{ param: "filter.enabled", label: "Filter enabled" }}>
            <ParamKnob param="filter.cutoff" label="Filter cutoff" legend="Cutoff" min={20} max={20000} step={1} taper={LOG} format={hertz} color="orange" resetValue={init.filter.cutoff} />
            <ParamKnob param="filter.resonance" label="Filter resonance" legend="Res" {...unit} resetValue={init.filter.resonance} />
            <ParamKnob param="filter.drive" label="Filter drive" legend="Drive" {...unit} color="orange" resetValue={init.filter.drive} />
            <ParamKnob param="filter.keytrack" label="Filter keytrack" legend="Key" {...unit} resetValue={init.filter.keytrack} />
          </Module>
          <Module title="Voice">
            <GlideModeSwitch />
            <ParamKnob param="voicing.glide" label="Glide time" legend="Time" min={0} max={2} step={0.001} taper={power(3)} format={seconds} color="orange" resetValue={0.06} />
            <ParamKnob param="voicing.drift" label="Analog drift" legend="Drift" {...unit} color="green" resetValue={init.voicing.drift} />
          </Module>
        </div>
      </TabsPanel>
    </Tabs>
  )
}
