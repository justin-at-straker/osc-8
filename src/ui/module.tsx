import type { ReactNode } from "react"
import { ParamSwitch } from "./controls"
import { usePatchValue } from "./use-patch"

/**
 * A printed section of the front panel. Given `power`, an on/off switch sits
 * in its header and the controls dim while it's off (they stay usable, so a
 * setting can be dialled in before switching the section on).
 */
export function Module({
  title,
  children,
  wide,
  power,
}: {
  title: string
  children: ReactNode
  wide?: boolean
  power?: { param: string; label: string }
}) {
  return (
    <section data-section data-osc-module data-wide={wide || undefined} aria-label={title}>
      {power ? <PoweredHeader title={title} power={power} /> : <h2>{title}</h2>}
      {power ? <PoweredControls param={power.param}>{children}</PoweredControls> : <div data-osc-controls>{children}</div>}
    </section>
  )
}

function PoweredHeader({ title, power }: { title: string; power: { param: string; label: string } }) {
  return (
    <h2 data-osc-powered>
      {title}
      <ParamSwitch param={power.param} label={power.label} compact />
    </h2>
  )
}

function PoweredControls({ param, children }: { param: string; children: ReactNode }) {
  const on = usePatchValue<boolean>(param)
  return (
    <div data-osc-controls data-off={!on || undefined}>
      {children}
    </div>
  )
}
