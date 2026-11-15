import { generateText } from "ai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultPatch } from "@/engine/patch"
import { replacePatch } from "@/state/store"
import { describeSteps, runSoundAgent } from "./agent"
import { clearKey, getKey, setKey } from "./keys"
import { getModel, MissingKeyError, ProviderNotAvailableError } from "./provider"




beforeEach(async () => {
  replacePatch(defaultPatch(), "load")
  await clearKey("openai")
  await clearKey("anthropic")
})

describe("UI-only agent", () => {
  it("offers only the UI SDK tools and refuses to run without the panel bridge", async () => {
    await setKey("openai", "sk-test")
    // uiAgent null = no panel bridge: must fail before any model or network work.
    await expect(runSoundAgent({ prompt: "warm pad", uiAgent: null })).rejects.toThrow(/panel is not ready/)
  })

  it("logs each act step in plain words", () => {
    expect(
      describeSteps({
        steps: [
          { ref: "Filter cutoff", action: "setValue", args: [2400] },
          { ref: "C4, bar 1, step 1", action: "press" },
          { ref: "FX", action: "select" },
        ],
      })
    ).toEqual(["Filter cutoff -> 2400", "pressed C4, bar 1, step 1", "FX -> "])
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
    const run = runSoundAgent({ prompt: "warm pad" })
    await expect(run).rejects.toBeInstanceOf(MissingKeyError)
    await expect(runSoundAgent({ prompt: "warm pad" })).rejects.toThrow(/No OpenAI API key saved/)
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
    await runSoundAgent({ prompt: "pluck", model, maxSteps: 1 }).catch(() => {})
    expect(captured).not.toBeNull()
    const c = captured!
    expect(c.url).toBe("https://api.openai.com/v1/responses")
    expect(c.headers.get("authorization")).toBe("Bearer sk-test-openai")
    expect(c.body.model).toBe("gpt-6-luna")
    expect(c.body).not.toHaveProperty("temperature")
    expect(c.body.parallel_tool_calls).toBe(false)
    const names = (c.body.tools as { name: string }[]).map((t) => t.name)
    expect(names.sort()).toEqual(["act", "query", "snapshot"])
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
