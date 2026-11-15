import * as React from "react"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs"
import { useStore } from "@/state/store"
import { FxPanel } from "./fx-panel"
import { SynthPanel } from "./synth-panel"
import { useUndoKeys } from "./use-undo-keys"

export type FrontPage = "synth" | "fx"

/**
 * The front panel: SYNTH and FX pages behind the kit's station-key tabs,
 * stood on end down the left so the pages don't cost the roll any height.
 * Both pages stay mounted, so the UI SDK agent can reach any knob from either.
 * The FX key carries an LED, lit while any effect is on.
 */
export function FrontPanel({ page, onPageChange }: { page?: FrontPage; onPageChange?: (page: FrontPage) => void }) {
  useUndoKeys()
  const [own, setOwn] = React.useState<FrontPage>("synth")
  const value = page ?? own
  const fxOn = useStore((s) => Object.values(s.patch.fx).some((fx) => fx.enabled))

  return (
    <Tabs
      data-kit="tabs"
      data-osc-front
      orientation="vertical"
      value={value}
      onValueChange={(next: unknown) => {
        setOwn(next as FrontPage)
        onPageChange?.(next as FrontPage)
      }}
    >
      <TabsList data-kit="tabs-list" aria-label="Front panel">
        <TabsTab value="synth" data-kit="tab">
          Synth
        </TabsTab>
        <TabsTab value="fx" data-kit="tab" aria-description={fxOn ? "Effects on" : undefined}>
          FX
          <i data-osc-tab-led data-on={fxOn || undefined} aria-hidden />
        </TabsTab>
      </TabsList>
      <TabsPanel value="synth" data-kit="tab-panel" keepMounted>
        <SynthPanel />
      </TabsPanel>
      <TabsPanel value="fx" data-kit="tab-panel" keepMounted>
        <FxPanel />
      </TabsPanel>
    </Tabs>
  )
}
