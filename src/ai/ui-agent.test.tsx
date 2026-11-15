import { render } from "@testing-library/react"
import { MockLanguageModelV4 } from "ai/test"
import { Slider, SliderControl, SliderThumb, SliderTrack } from "@ui-sdk/react/slider"
import { useState } from "react"
import { beforeEach, expect, it } from "vitest"
import { defaultPatch } from "@/engine/patch"
import { getState, replacePatch, setPatchValue } from "@/state/store"
import { runSoundAgent } from "./agent"
import { getUiAgent } from "./ui-agent"

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

const sources: string[] = []

// Stand-in for a synth-panel knob: a ui-sdk slider bound to filter.cutoff.
function CutoffKnob() {
  const [value, setValue] = useState(getState().patch.filter.cutoff)
  return (
    <div data-param="filter.cutoff">
      <Slider
        aria-label="Filter cutoff"
        min={20}
        max={20000}
        value={value}
        onValueChange={(next, details) => {
          sources.push(details.source)
          setValue(next as number)
          setPatchValue("filter.cutoff", next, details.source === "agent" ? "agent" : "user")
        }}
      >
        <SliderControl>
          <SliderTrack>
            <SliderThumb />
          </SliderTrack>
        </SliderControl>
      </Slider>
    </div>
  )
}

beforeEach(() => {
  replacePatch(defaultPatch(), "load")
  sources.length = 0
})

it("act moves the real Filter cutoff knob, reporting source agent", async () => {
  const agent = getUiAgent()
  render(<CutoffKnob />)
  expect(agent.snapshot().some((c) => c.label === "Filter cutoff")).toBe(true)

  const model = new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "act",
            input: JSON.stringify({ steps: [{ ref: "Filter cutoff", action: "setValue", args: [5600] }] }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      { content: [{ type: "text", text: "Opened the filter a bit." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    ],
  })

  const summary = await runSoundAgent({ prompt: "a bit brighter", model })
  expect(summary).toBe("Opened the filter a bit.")
  expect(sources).toContain("agent")
  expect(getState().patch.filter.cutoff).toBe(5600)

  // The model was offered both toolsets in one call.
  const offered = model.doGenerateCalls[0]!.tools!.map((t) => t.name)
  expect([...offered].sort()).toEqual(["act", "query", "snapshot"]) // UI SDK tools only
})
