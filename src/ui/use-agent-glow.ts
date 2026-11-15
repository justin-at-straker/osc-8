import * as React from "react"
import { getUiAgent } from "@/ai/ui-agent"
import { elementForLabel, glow } from "./agent-glow"

/**
 * Light whatever the UI SDK agent changes: every change it makes through a
 * component reports source "agent"; the control with that label glows for a
 * moment. The step grids light their own cells instead (see grid-agent).
 */
export function useAgentGlow() {
  React.useEffect(() => {
    return getUiAgent().subscribe((change) => {
      if (change.source !== "agent" || !change.label) return
      const el = elementForLabel(change.label)
      if (!el || el.closest("[data-osc-grid]")) return
      glow(el)
    })
  }, [])
}
