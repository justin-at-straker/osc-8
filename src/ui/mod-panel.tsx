import * as React from "react"
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from "@ui-sdk/react/slider"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs"
import { defaultPatch, Lfo, LFO_SHAPES, MOD_SOURCES } from "@/engine/patch"
import { useStore } from "@/state/store"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { CompactSelect } from "./compact-select"
import { ParamKnob, ParamSlide, ParamSwitch, StepperControl } from "./controls"
import {
  addRoute,
  formatAmount,
  TARGET_LABELS,
  MAX_ROUTES,
  removeRoute,
  selectRoute,
  setRouteAmount,
  setRouteAux,
  SOURCE_LABELS,
  sourceFamily,
  targetLabel,
  useSelectedRoute,
  type ModSource,
} from "./mod-model"
import { ModHandle } from "./mod-ui"
import { formatRate, power } from "./taper"
import { usePatchValue, writePatchValue } from "./use-patch"

const init = defaultPatch()
const DIVISIONS = Lfo.shape.syncDivision.options
const seconds: Intl.NumberFormatOptions = { style: "unit", unit: "second", unitDisplay: "narrow", maximumSignificantDigits: 2 }
const percent: Intl.NumberFormatOptions = { style: "percent", maximumFractionDigits: 0 }
const twoDigits: Intl.NumberFormatOptions = { maximumSignificantDigits: 3 }

/** A one-cycle sketch of an LFO shape, printed in the module header. */
const SHAPE_PATHS: Record<(typeof LFO_SHAPES)[number], string> = {
  sine: "M0 6 C3 -2 5 -2 8 6 S13 14 16 6",
  triangle: "M0 6 L4 1 L12 11 L16 6",
  saw: "M0 11 L8 1 L8 11 L16 1 L16 11",
  square: "M0 11 L0 1 L8 1 L8 11 L16 11 L16 1",
  random: "M0 8 H3 V2 H6 V10 H9 V4 H12 V7 H16",
}

function ShapeSketch({ index }: { index: number }) {
  const shape = usePatchValue<(typeof LFO_SHAPES)[number]>(`lfos.${index}.shape`)
  return (
    <svg data-osc-shape viewBox="-1 -1 18 14" aria-hidden>
      <path d={SHAPE_PATHS[shape]} />
    </svg>
  )
}

function ModModule({ title, source, children, extra }: { title: string; source: ModSource; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section data-section data-osc-module data-osc-mod-module data-family={sourceFamily(source)} aria-label={title}>
      <h2 data-osc-powered>
        {title}
        {extra}
        <ModHandle source={source} />
      </h2>
      <div data-osc-controls>{children}</div>
    </section>
  )
}

function LfoModule({ index }: { index: number }) {
  const n = index + 1
  const path = `lfos.${index}`
  const sync = usePatchValue<boolean>(`${path}.sync`)
  const division = usePatchValue<(typeof DIVISIONS)[number]>(`${path}.syncDivision`)
  return (
    <ModModule title={`LFO ${n}`} source={`lfo${n}` as ModSource} extra={<ShapeSketch index={index} />}>
      <ParamSlide param={`${path}.shape`} label={`LFO ${n} shape`} options={LFO_SHAPES} />
      <div data-osc-lfo-rate>
        {sync ? (
          <div data-osc-division>
            <CompactSelect
              label={`LFO ${n} division`}
              param={`${path}.syncDivision`}
              value={division}
              options={DIVISIONS.map((d) => ({ value: d, label: d }))}
              onValueChange={(next) => writePatchValue(`${path}.syncDivision`, next)}
            />
            <span data-osc-legend aria-hidden>
              Rate
            </span>
          </div>
        ) : (
          <ParamKnob
            param={`${path}.rate`}
            label={`LFO ${n} rate`}
            legend="Rate"
            min={0.01}
            max={50}
            step={0.01}
            taper={power(3)}
            format={twoDigits}
            displayValue={formatRate}
            color="green"
            resetValue={1}
          />
        )}
      </div>
      <div data-osc-stack data-osc-lfo-switches>
        <ParamSwitch param={`${path}.sync`} label={`LFO ${n} sync`} legend="Sync" />
        <ParamSwitch param={`${path}.oneShot`} label={`LFO ${n} one-shot`} legend="1-Shot" />
      </div>
    </ModModule>
  )
}

function EnvModule({ env }: { env: "env2" | "env3" }) {
  const n = env.slice(3)
  const knob = (stage: "attack" | "decay" | "release", legend: string) => (
    <ParamKnob
      param={`${env}.${stage}`}
      label={`Env ${n} ${stage}`}
      legend={legend}
      min={0}
      max={20}
      step={0.001}
      taper={power(4)}
      format={seconds}
      color="blue"
      resetValue={init[env][stage]}
    />
  )
  return (
    <ModModule title={`Env ${n}`} source={env}>
      {knob("attack", "Attack")}
      {knob("decay", "Decay")}
      <ParamKnob param={`${env}.sustain`} label={`Env ${n} sustain`} legend="Sustain" min={0} max={1} step={0.001} format={percent} color="blue" resetValue={init[env].sustain} />
      {knob("release", "Release")}
    </ModModule>
  )
}

const AMOUNT_FORMAT: Intl.NumberFormatOptions = { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 0 }
const AUX_OPTIONS = MOD_SOURCES.map((s) => ({ value: s, label: s === "none" ? "No aux" : SOURCE_LABELS[s] }))

function RouteRow({ index }: { index: number }) {
  const route = useStore((s) => s.patch.mod[index])
  const selected = useSelectedRoute() === index
  if (!route) return null
  const n = index + 1
  return (
    <li
      data-osc-route
      data-family={sourceFamily(route.source)}
      data-selected={selected || undefined}
      aria-label={`Route ${n}: ${SOURCE_LABELS[route.source]} to ${targetLabel(route.target)}`}
      onPointerDown={() => selectRoute(index)}
      onFocus={() => selectRoute(index)}
    >
      <span data-osc-route-n aria-hidden>
        {String(n).padStart(2, "0")}
      </span>
      <span data-osc-route-source>{SOURCE_LABELS[route.source]}</span>
      <span data-osc-route-target>{targetLabel(route.target)}</span>
      <Slider
        data-osc-route-amount
        data-param={`mod.${index}.amount`}
        min={-1}
        max={1}
        step={0.01}
        format={AMOUNT_FORMAT}
        locale="en-US"
        value={route.amount}
        onValueChange={(next) => setRouteAmount(index, next as number)}
      >
        <SliderControl data-osc-amt-control>
          <SliderTrack data-osc-amt-track style={{ "--amt": route.amount } as React.CSSProperties}>
            <SliderIndicator data-osc-amt-indicator hidden />
            <SliderThumb data-osc-amt-thumb aria-label={`Route ${n} amount`} />
          </SliderTrack>
        </SliderControl>
      </Slider>
      <span data-osc-route-value aria-hidden>
        {formatAmount(route.amount)}
      </span>
      <CompactSelect label={`Route ${n} aux`} param={`mod.${index}.aux`} value={route.aux} options={AUX_OPTIONS} onValueChange={(next) => setRouteAux(index, next)} />
      <Button aria-label={`Delete route ${n}`} data-osc-route-delete onClick={() => removeRoute(index)}>
        <Icon name="close" />
      </Button>
    </li>
  )
}

const NEW_SOURCES = MOD_SOURCES.filter((s) => s !== "none").map((s) => ({ value: s, label: SOURCE_LABELS[s] }))
const NEW_TARGETS = Object.keys(TARGET_LABELS).map((t) => ({ value: t, label: TARGET_LABELS[t] }))

/** Add a route without dragging: source, target, amount, Add. How the agent (and the keyboard) builds the matrix. */
function AddRouteForm({ full }: { full: boolean }) {
  const [source, setSourceState] = React.useState<ModSource>("lfo1")
  const [target, setTargetState] = React.useState("filter.cutoff")
  const [amount, setAmountState] = React.useState(25)
  // The agent can set all three and press Add in one turn, before React re-renders:
  // Add reads what was chosen last, not the last render's state.
  const chosen = React.useRef({ source, target, amount })
  const setSource = (v: ModSource) => ((chosen.current.source = v), setSourceState(v))
  const setTarget = (v: string) => ((chosen.current.target = v), setTargetState(v))
  const setAmount = (v: number) => ((chosen.current.amount = v), setAmountState(v))
  return (
    <div data-osc-add-route role="group" aria-label="Add a route">
      <CompactSelect label="New route source" value={source} options={NEW_SOURCES} onValueChange={(v) => setSource(v as ModSource)} />
      <span data-osc-legend aria-hidden>
        to
      </span>
      <CompactSelect label="New route target" value={target} options={NEW_TARGETS} onValueChange={setTarget} />
      <StepperControl label="New route amount" legend="%" value={amount} min={-100} max={100} signed onValueChange={setAmount} />
      <Button aria-label="Add route" data-osc-add-route-key disabled={full} onClick={() => addRoute(chosen.current.source, chosen.current.target, chosen.current.amount / 100)}>
        Add
      </Button>
    </div>
  )
}

function RoutesList() {
  const count = useStore((s) => s.patch.mod.length)
  return (
    <section data-section data-osc-module data-osc-routes aria-label="Mod routes">
      <h2>
        Routes {count}/{MAX_ROUTES}
      </h2>
      <AddRouteForm full={count >= MAX_ROUTES} />
      {count === 0 ? (
        <p data-osc-routes-empty>Drag an LFO or ENV handle onto any knob</p>
      ) : (
        <ol data-osc-route-list>
          {Array.from({ length: count }, (_, i) => (
            <RouteRow key={i} index={i} />
          ))}
        </ol>
      )}
    </section>
  )
}

export type ModPage = "lfo" | "env" | "routes"

/**
 * The MOD page: sub-pages for the four LFOs, Env 2/3 and the routes list,
 * chosen with small keys down its left edge. Every module has its drag handle.
 */
export function ModPanel() {
  const [page, setPage] = React.useState<ModPage>("lfo")
  const count = useStore((s) => s.patch.mod.length)
  return (
    <Tabs data-osc-mod orientation="vertical" value={page} onValueChange={(next: unknown) => setPage(next as ModPage)}>
      <TabsList data-osc-subtabs aria-label="Modulation pages">
        <TabsTab value="lfo" data-osc-subtab>
          LFO
        </TabsTab>
        <TabsTab value="env" data-osc-subtab>
          Env
        </TabsTab>
        <TabsTab value="routes" data-osc-subtab aria-label={`Routes, ${count}`}>
          Routes <b>{count}</b>
        </TabsTab>
      </TabsList>
      <TabsPanel value="lfo" keepMounted data-osc-subpanel>
        <div data-osc-panel data-osc-lfos>
          {[0, 1, 2, 3].map((i) => (
            <LfoModule key={i} index={i} />
          ))}
        </div>
      </TabsPanel>
      <TabsPanel value="env" keepMounted data-osc-subpanel>
        <div data-osc-panel data-osc-envs>
          <EnvModule env="env2" />
          <EnvModule env="env3" />
        </div>
      </TabsPanel>
      <TabsPanel value="routes" keepMounted data-osc-subpanel>
        <RoutesList />
      </TabsPanel>
    </Tabs>
  )
}
