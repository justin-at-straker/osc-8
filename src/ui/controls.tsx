import { Field, FieldLabel } from "@ui-sdk/react/field"
import { NumberInput, NumberInputControl, NumberInputDecrement, NumberInputGroup, NumberInputIncrement } from "@ui-sdk/react/number-input"
import { Switch, SwitchThumb } from "@ui-sdk/react/switch"
import { haptic } from "@/lib/haptics"
import { Icon } from "@/components/ui/icon"
import { ModeDial } from "@/components/ui/mode-dial"
import { SlideSwitch } from "@/components/ui/slide-switch"
import * as React from "react"
import { getState, useStore } from "@/state/store"
import { Knob, type KnobProps } from "./knob"
import { fromModSpace, isModTarget, parseSummary, routeSummary, setRouteAmount, toModSpace } from "./mod-model"
import { useLiveModValue } from "./mod-live"
import { ModTargetArea } from "./mod-ui"
import { LINEAR, toTravel } from "./taper"
import { usePatchValue, writePatchValue } from "./use-patch"

// Store-bound controls. Each wraps a SPEC-01 skin (or the same markup, where
// the kit's version is uncontrolled) and carries `data-param` with its patch path.

type ParamKnobProps = Omit<KnobProps, "value" | "onValueChange" | "param" | "ring" | "ringDrag"> & { param: string }

/** A knob bound to a numeric patch field. Mod targets also take drops, a "Modulate with" menu, and draw their routes. */
export function ParamKnob(props: ParamKnobProps) {
  return isModTarget(props.param) ? <ModulatedKnob {...props} /> : <PlainKnob {...props} />
}

function PlainKnob({ param, ...props }: ParamKnobProps) {
  const value = usePatchValue<number>(param)
  return <Knob {...props} param={param} value={value} onValueChange={(next) => writePatchValue(param, next)} />
}

function ModulatedKnob({ param, ...props }: ParamKnobProps) {
  const value = usePatchValue<number>(param)
  const summary = parseSummary(useStore((s) => routeSummary(s.patch.mod, param)))
  const live = useLiveModValue(param)
  const taper = props.taper ?? LINEAR

  // Where the routes take the value: in the target's mod range (log for cutoff), back to knob travel.
  const ring = summary
    ? { to: toTravel(fromModSpace(param, toModSpace(param, value) + summary.sum), props.min, props.max, taper), family: summary.family }
    : undefined
  // Ring drags adjust the newest route into this knob, from its amount at the press.
  const last = summary?.last ?? -1
  const ringDrag = React.useMemo(() => {
    if (last < 0) return undefined
    const press = { amount: 0 }
    return {
      begin: () => void (press.amount = getState().patch.mod[last]?.amount ?? 0),
      move: (delta: number) => setRouteAmount(last, press.amount + delta),
    }
  }, [last])
  return (
    <ModTargetArea target={param}>
      <Knob {...props} param={param} value={value} ring={ring} ringDrag={ringDrag} liveValue={live} onValueChange={(next) => writePatchValue(param, next)} />
    </ModTargetArea>
  )
}

/** The kit's Stepper, controlled: minus, a readout, plus. For whole numbers like octave or note length. */
export function StepperControl({
  label,
  legend,
  value,
  min,
  max,
  signed,
  param,
  onValueChange,
}: {
  label: string
  legend?: string
  value: number
  min: number
  max: number
  signed?: boolean
  param?: string
  onValueChange: (value: number) => void
}) {
  return (
    <div data-param={param} data-osc-stepper>
      <NumberInput
        value={value}
        min={min}
        max={max}
        step={1}
        locale="en-US"
        format={signed ? { signDisplay: "exceptZero" } : undefined}
        onValueChange={(next) => {
          if (next === null || next === value) return
          haptic("selection")
          onValueChange(Math.min(max, Math.max(min, Math.round(next))))
        }}
      >
        <Field data-kit="field">
          <FieldLabel data-kit="label" aria-hidden>
            {legend ?? label}
          </FieldLabel>
          <NumberInputGroup data-kit="stepper">
            <NumberInputDecrement data-kit="button" data-tone="secondary" aria-label={`Decrease ${label}`}>
              <Icon name="minus" />
            </NumberInputDecrement>
            <NumberInputControl data-kit="stepper-input" aria-label={label} />
            <NumberInputIncrement data-kit="button" data-tone="secondary" aria-label={`Increase ${label}`}>
              <Icon name="plus" />
            </NumberInputIncrement>
          </NumberInputGroup>
        </Field>
      </NumberInput>
    </div>
  )
}

/** A stepper bound to a whole-number patch field (a drop target too, when it's modulatable, like semitone). */
export function ParamStepper({
  param,
  ...props
}: {
  param: string
  label: string
  legend?: string
  min: number
  max: number
  signed?: boolean
}) {
  const value = usePatchValue<number>(param)
  const stepper = <StepperControl {...props} param={param} value={value} onValueChange={(next) => writePatchValue(param, next)} />
  return isModTarget(param) ? <ModTargetArea target={param}>{stepper}</ModTargetArea> : stepper
}

/** An on/off switch bound to a boolean patch field. */
export function ParamSwitch({ param, label, legend, compact }: { param: string; label: string; legend?: string; compact?: boolean }) {
  const checked = usePatchValue<boolean>(param)
  return (
    <div data-param={param} data-osc-switch={compact ? "compact" : ""}>
      <Switch
        data-kit="switch"
        aria-label={label}
        checked={checked}
        onCheckedChange={(next) => {
          haptic("selection")
          writePatchValue(param, next)
        }}
      >
        <SwitchThumb data-kit="switch-thumb" />
      </Switch>
      {!compact && (
        <span data-osc-legend aria-hidden>
          {legend ?? label}
        </span>
      )}
    </div>
  )
}

/** The kit's mode dial bound to a string patch field. */
export function ParamDial({
  param,
  label,
  options,
  value,
  onChange,
}: {
  param: string
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div data-param={param} data-osc-dial-wrap>
      <ModeDial label={label} options={options} value={value} onValueChange={onChange} sweep={200} />
    </div>
  )
}

/** The kit's slide switch, vertical, bound to a string patch field: for a handful of short choices like a distortion type. */
export function ParamSlide({ param, label, options, numeric }: { param: string; label: string; options: readonly string[]; /** The field is a number; options are its values as text, e.g. "-2". */ numeric?: boolean }) {
  const value = usePatchValue<string | number>(param)
  return (
    <div data-param={param} data-osc-slide>
      <SlideSwitch
        label={label}
        options={[...options]}
        value={String(value)}
        orientation="vertical"
        onValueChange={(next) => writePatchValue(param, numeric ? Number(next) : next)}
      />
    </div>
  )
}
