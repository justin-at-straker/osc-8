import type { ReactNode } from "react"
import { BUILTIN_TABLES, defaultPatch } from "@/engine/patch"
import { redo, undo } from "@/state/store"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { LOG, power } from "./taper"
import { ParamDial, ParamKnob, ParamStepper, ParamSwitch } from "./controls"
import { usePatchValue, writePatchValue } from "./use-patch"
import { useUndoKeys } from "./use-undo-keys"

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

function TableDial() {
  const table = usePatchValue<{ kind: string; name?: string }>("oscA.table")
  const current = table.kind === "builtin" && table.name ? table.name : ""
  return (
    <ParamDial
      param="oscA.table"
      label="Osc A table"
      value={current}
      options={BUILTIN_TABLES.map((name) => ({ value: name, label: TABLE_LABELS[name] }))}
      onChange={(name) => writePatchValue("oscA.table", { kind: "builtin", name })}
    />
  )
}

function Module({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section data-section data-osc-module data-wide={wide || undefined} aria-label={title}>
      <h2>{title}</h2>
      <div data-osc-controls>{children}</div>
    </section>
  )
}

/** The synth front panel: OSC A, FILTER, AMP ENV and MASTER, every control bound to the patch store. */
export function SynthPanel() {
  useUndoKeys()
  return (
    <div data-osc-panel>
      <Module title="Osc A" wide>
        <TableDial />
        <ParamKnob param="oscA.position" label="Osc A position" legend="WT Pos" min={0} max={1} step={0.001} format={percent} color="orange" resetValue={init.oscA.position} />
        <ParamKnob param="oscA.level" label="Osc A level" legend="Level" min={0} max={1} step={0.001} format={percent} resetValue={init.oscA.level} />
        <div data-osc-stack>
          <ParamStepper param="oscA.octave" label="Osc A octave" legend="Oct" min={-4} max={4} signed />
          <ParamStepper param="oscA.semi" label="Osc A semitone" legend="Semi" min={-12} max={12} signed />
        </div>
        <ParamKnob param="oscA.fine" label="Osc A fine tune" legend="Fine" min={-100} max={100} step={1} format={cents} resetValue={0} />
      </Module>
      <Module title="Filter">
        <ParamSwitch param="filter.enabled" label="Filter enabled" legend="Filter" />
        <ParamKnob param="filter.cutoff" label="Filter cutoff" legend="Cutoff" min={20} max={20000} step={1} taper={LOG} format={hertz} color="orange" resetValue={init.filter.cutoff} />
        <ParamKnob param="filter.resonance" label="Filter resonance" legend="Res" min={0} max={1} step={0.001} format={percent} resetValue={init.filter.resonance} />
      </Module>
      <Module title="Amp Env">
        <ParamKnob param="env1.attack" label="Amp attack" legend="Attack" min={0} max={20} step={0.001} taper={power(4)} format={seconds} color="green" resetValue={init.env1.attack} />
        <ParamKnob param="env1.decay" label="Amp decay" legend="Decay" min={0} max={20} step={0.001} taper={power(4)} format={seconds} color="green" resetValue={init.env1.decay} />
        <ParamKnob param="env1.sustain" label="Amp sustain" legend="Sustain" min={0} max={1} step={0.001} format={percent} color="green" resetValue={init.env1.sustain} />
        <ParamKnob param="env1.release" label="Amp release" legend="Release" min={0} max={20} step={0.001} taper={power(4)} format={seconds} color="green" resetValue={init.env1.release} />
      </Module>
      <Module title="Master">
        <ParamKnob param="master.volume" label="Master volume" legend="Volume" min={0} max={1} step={0.001} format={percent} color="blue" resetValue={init.master.volume} />
        <div data-osc-stack data-osc-history>
          <Button aria-label="Undo" onClick={() => undo()}>
            <Icon name="undo" />
          </Button>
          <Button aria-label="Redo" onClick={() => redo()}>
            <Icon name="redo" />
          </Button>
        </div>
      </Module>
    </div>
  )
}
