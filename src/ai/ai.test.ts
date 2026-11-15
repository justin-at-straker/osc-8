import { generateText } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultPatch } from "@/engine/patch"
import { getState, replacePatch } from "@/state/store"
import { runSoundAgent } from "./agent"
import { clearKey, getKey, setKey } from "./keys"
import { getModel, MissingKeyError, ProviderNotAvailableError } from "./provider"
import { applySetPatch, createPatchTools } from "./tools"

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

function toolCallThenText(toolName: string, input: unknown, text = "Done.") {
  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [{ type: "tool-call", toolCallId: "call-1", toolName, input: JSON.stringify(input) }],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  })
}

/** The tool-result output the model saw on its second call. */
function secondCallToolOutput(model: MockLanguageModelV4) {
  const prompt = model.doGenerateCalls[1]!.prompt
  const toolMsg = prompt.find((m) => m.role === "tool")!
  const part = (toolMsg.content as { type: string; output?: { type: string; value: unknown } }[]).find((p) => p.type === "tool-result")!
  return part.output!
}

beforeEach(async () => {
  replacePatch(defaultPatch(), "load")
  await clearKey("openai")
  await clearKey("anthropic")
})

describe("setPatch tool", () => {
  it("applies a valid section-level partial to the store", async () => {
    const model = toolCallThenText("setPatch", {
      name: "Dark Reese",
      oscA: { table: { kind: "builtin", name: "basic" }, position: 0.66, octave: -1, unison: 7, detune: 0.4 },
      filter: { cutoff: 380, resonance: 0.35 },
      fx: { reverb: { mix: 0.1 } },
    }, "Made a dark reese.")
    const statuses: string[] = []
    const summary = await runSoundAgent({ prompt: "make a dark detuned reese", model, uiAgent: null, onStatus: (s) => statuses.push(s.message) })

    expect(summary).toBe("Made a dark reese.")
    const p = getState().patch
    expect(p.name).toBe("Dark Reese")
    expect(p.oscA.position).toBe(0.66)
    expect(p.oscA.octave).toBe(-1)
    expect(p.oscA.level).toBe(0.75) // untouched field kept
    expect(p.filter.cutoff).toBe(380)
    expect(p.filter.type).toBe("lp24")
    expect(p.fx.reverb.mix).toBe(0.1) // nested partial merged...
    expect(p.fx.reverb.size).toBe(0.6) // ...onto the rest of the effect
    expect(statuses).toContain('setting patch "Dark Reese"')

    const out = secondCallToolOutput(model)
    expect(out.value).toMatchObject({ ok: true, name: "Dark Reese" })
    expect((out.value as { silentInM1: string[] }).silentInM1).toEqual([]) // unison is audible since params 131+)
  })

  it("returns an error result for invalid input and leaves the patch unchanged", async () => {
    const before = getState().patch
    const model = toolCallThenText("setPatch", { name: "Too Bright", filter: { cutoff: 99999 } })
    await runSoundAgent({ prompt: "brightest possible", model, uiAgent: null })

    expect(getState().patch).toBe(before)
    const out = secondCallToolOutput(model)
    expect(out.type).toBe("json")
    expect(out.value).toMatchObject({ ok: false })
    expect((out.value as { error: string }).error).toMatch(/cutoff/)
  })

  it("rejects misspelled fields instead of dropping them", () => {
    const before = getState().patch
    const result = applySetPatch({ filter: { cutof: 500 } })
    expect(result.ok).toBe(false)
    expect(getState().patch).toBe(before)
  })

  it("getPatch returns the current patch", async () => {
    const tools = createPatchTools()
    const out = await tools.getPatch.execute!({}, { toolCallId: "x", messages: [] } as never)
    expect((out as { patch: unknown }).patch).toEqual(getState().patch)
  })
})

describe("keys and provider", () => {
  it("round-trips a key (in-memory fallback without IndexedDB)", async () => {
    expect(await getKey("openai")).toBeNull()
    await setKey("openai", "  sk-test-123456789  ")
    expect(await getKey("openai")).toBe("sk-test-123456789")
    await clearKey("openai")
    expect(await getKey("openai")).toBeNull()
  })

  it("missing key yields a clear error", async () => {
    const run = runSoundAgent({ prompt: "warm pad", uiAgent: null })
    await expect(run).rejects.toBeInstanceOf(MissingKeyError)
    await expect(runSoundAgent({ prompt: "warm pad", uiAgent: null })).rejects.toThrow(/No OpenAI API key saved/)
  })

  it("openrouter is not available yet", async () => {
    await expect(getModel({ provider: "openrouter", model: "x", apiKey: "k" })).rejects.toBeInstanceOf(ProviderNotAvailableError)
  })
})

describe("browser-direct request shape (fetch intercepted, no network)", () => {
  type Captured = { url: string; headers: Headers; body: Record<string, unknown> }
  let captured: Captured | null = null
  const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) }
    return new Response(JSON.stringify({ error: { message: "intercepted" } }), { status: 400, headers: { "content-type": "application/json" } })
  })
  afterEach(() => {
    captured = null
    fakeFetch.mockClear()
  })

  it("OpenAI: Responses API, bearer key, default model, no temperature, tools sequential", async () => {
    const model = await getModel({ provider: "openai", model: "gpt-6-luna", apiKey: "sk-test-openai", fetch: fakeFetch })
    await runSoundAgent({ prompt: "pluck", model, uiAgent: null, maxSteps: 1 }).catch(() => {})
    expect(captured).not.toBeNull()
    const c = captured!
    expect(c.url).toBe("https://api.openai.com/v1/responses")
    expect(c.headers.get("authorization")).toBe("Bearer sk-test-openai")
    expect(c.body.model).toBe("gpt-6-luna")
    expect(c.body).not.toHaveProperty("temperature")
    expect(c.body.parallel_tool_calls).toBe(false)
    const names = (c.body.tools as { name: string }[]).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(["setPatch", "getPatch"]))
  })

  it("Anthropic: messages endpoint with the direct-browser-access header", async () => {
    const model = await getModel({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-ant-test", fetch: fakeFetch })
    await generateText({ model, prompt: "hi", maxRetries: 0 }).catch(() => {})
    const c = captured!
    expect(c.url).toBe("https://api.anthropic.com/v1/messages")
    expect(c.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true")
    expect(c.headers.get("x-api-key")).toBe("sk-ant-test")
    expect(c.body.model).toBe("claude-sonnet-5-5")
  })
})
