import { BUILTIN_TABLES, defaultPatch } from "@/engine/patch"
import { LOG, power } from "./taper"
import { ParamDial, ParamKnob, ParamStepper } from "./controls"
import { usePatchValue, writePatchValue } from "./use-patch"
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

/** The synth page of the front panel: OSC A, FILTER, AMP ENV and MASTER, every control bound to the patch store. Undo lives in the menubar and Ctrl+Z. */
export function SynthPanel() {
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
      <Module title="Filter" power={{ param: "filter.enabled", label: "Filter enabled" }}>
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
      </Module>
    </div>
  )
}
