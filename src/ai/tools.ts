// AI tools. The AI operates OSC-8 only through the UI SDK agent bridge
// (snapshot / query / act), exactly as a person would, so every change it
// makes goes through a visible control and reports the source "agent".
// There are deliberately no tools that write the store directly.
import { jsonSchema, tool, type ToolSet } from "ai"
import type { UiAgent } from "./ui-agent"

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Wrap the UI SDK's own agent tool definitions as AI SDK tools. Errors become tool results the model can read. */
export function createUiTools(agent: UiAgent, defs: readonly { name: string; description: string; inputSchema: unknown }[]) {
  const tools: ToolSet = {}
  for (const def of defs) {
    const name = def.name as "snapshot" | "query" | "act"
    if (!(name in agent)) continue
    tools[name] = tool({
      description: def.description,
      inputSchema: jsonSchema<Record<string, unknown>>(def.inputSchema as never),
      execute: async (input) => {
        try {
          return await (agent[name] as (i: unknown) => unknown)(input ?? {})
        } catch (error) {
          return { ok: false, error: describeError(error) }
        }
      },
    })
  }
  return tools
}
