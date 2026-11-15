import { defaultPatch, DELAY_TIMES, DIST_TYPES } from "@/engine/patch"
import { ParamKnob, ParamSlide, ParamSwitch } from "./controls"
import { Module } from "./module"
import { formatDb, formatRate, power } from "./taper"

const init = defaultPatch().fx

const percent: Intl.NumberFormatOptions = { style: "percent", maximumFractionDigits: 0 }
const twoDigits: Intl.NumberFormatOptions = { maximumSignificantDigits: 2 }
const decibels: Intl.NumberFormatOptions = { signDisplay: "exceptZero", minimumFractionDigits: 1, maximumFractionDigits: 1 }

const unit = { min: 0, max: 1, step: 0.001, format: percent }

/** The FX chain in signal order: distortion, chorus, delay, reverb, OTT, EQ. Every control bound to patch.fx. */
export function FxPanel() {
  return (
    <div data-osc-panel data-osc-fx>
      <Module title="Distortion" power={{ param: "fx.distortion.enabled", label: "Distortion enabled" }}>
        <ParamSlide param="fx.distortion.type" label="Distortion type" options={DIST_TYPES} />
        <ParamKnob param="fx.distortion.drive" label="Distortion drive" legend="Drive" {...unit} color="orange" resetValue={init.distortion.drive} />
        <ParamKnob param="fx.distortion.mix" label="Distortion mix" legend="Mix" {...unit} resetValue={init.distortion.mix} />
      </Module>
      <Module title="Chorus" power={{ param: "fx.chorus.enabled", label: "Chorus enabled" }}>
        <ParamKnob
          param="fx.chorus.rate"
          label="Chorus rate"
          legend="Rate"
          min={0.01}
          max={10}
          step={0.01}
          taper={power(3)}
          format={twoDigits}
          displayValue={formatRate}
          color="green"
          resetValue={init.chorus.rate}
        />
        <ParamKnob param="fx.chorus.depth" label="Chorus depth" legend="Depth" {...unit} resetValue={init.chorus.depth} />
        <ParamKnob param="fx.chorus.mix" label="Chorus mix" legend="Mix" {...unit} resetValue={init.chorus.mix} />
      </Module>
      <Module title="Delay" power={{ param: "fx.delay.enabled", label: "Delay enabled" }}>
        <ParamSlide param="fx.delay.time" label="Delay time" options={DELAY_TIMES} />
        <ParamKnob param="fx.delay.feedback" label="Delay feedback" legend="Fdbk" {...unit} color="orange" resetValue={init.delay.feedback} />
        <ParamKnob param="fx.delay.mix" label="Delay mix" legend="Mix" {...unit} resetValue={init.delay.mix} />
        <ParamSwitch param="fx.delay.pingPong" label="Delay ping-pong" legend="P-Pong" />
      </Module>
      <Module title="Reverb" power={{ param: "fx.reverb.enabled", label: "Reverb enabled" }}>
        <ParamKnob param="fx.reverb.size" label="Reverb size" legend="Size" {...unit} color="blue" resetValue={init.reverb.size} />
        <ParamKnob param="fx.reverb.decay" label="Reverb decay" legend="Decay" {...unit} color="blue" resetValue={init.reverb.decay} />
        <ParamKnob param="fx.reverb.damping" label="Reverb damping" legend="Damp" {...unit} resetValue={init.reverb.damping} />
        <ParamKnob param="fx.reverb.mix" label="Reverb mix" legend="Mix" {...unit} resetValue={init.reverb.mix} />
      </Module>
      <Module title="OTT" power={{ param: "fx.ott.enabled", label: "OTT enabled" }}>
        <ParamKnob param="fx.ott.depth" label="OTT depth" legend="Depth" {...unit} color="orange" resetValue={init.ott.depth} />
        <ParamKnob param="fx.ott.time" label="OTT time" legend="Time" {...unit} resetValue={init.ott.time} />
      </Module>
      <Module title="EQ" power={{ param: "fx.eq.enabled", label: "EQ enabled" }}>
        {(["low", "mid", "high"] as const).map((band) => (
          <ParamKnob
            key={band}
            param={`fx.eq.${band}`}
            label={`EQ ${band}`}
            legend={band}
            min={-12}
            max={12}
            step={0.1}
            format={decibels}
            displayValue={formatDb}
            color="white"
            resetValue={0}
          />
        ))}
      </Module>
    </div>
  )
}
