// The UI SDK agent bridge: lets the model read and move every ui-sdk component
// on the page (the synth panel's knobs are ui-sdk sliders/number inputs/radios),
// through each component's own API, reporting source "agent" to its
// on<Key>Change. Created when this module loads; import it before the app
// renders (main.tsx) so it hears every component as it's made.
//
// The AI widgets themselves (DescribeField, KeySettings) sit inside
// `data-agent-hidden`, so the model can't type into its own prompt or read the key.
import { agentTools, createAgent } from "@ui-sdk/react/agent"

export type UiAgent = ReturnType<typeof createAgent>

let agent: UiAgent | null = null

/** The page's one bridge, created on first use. */
export function getUiAgent(): UiAgent {
  agent ??= createAgent()
  return agent
}

export { agentTools }

if (typeof document !== "undefined") getUiAgent()
