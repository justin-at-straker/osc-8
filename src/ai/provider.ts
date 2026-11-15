// Provider abstraction for BYOK, browser-direct AI. The app has no server: the
// AI SDK runs in the page and calls the provider's API with the user's key.
// M1 ships OpenAI (default) and Anthropic; OpenRouter lands in M5.
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { generateText, type LanguageModel } from "ai"
import { getKey } from "./keys"

export type Provider = "openai" | "anthropic" | "openrouter"

export type AiSettings = {
  provider: Provider
  /** The provider's model id, e.g. "gpt-6-luna". */
  model: string
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  openai: "gpt-6-luna",
  anthropic: "claude-sonnet-5-5",
  openrouter: "openai/gpt-6-luna",
}

export const DEFAULT_SETTINGS: AiSettings = { provider: "openai", model: DEFAULT_MODELS.openai }

export class MissingKeyError extends Error {
  readonly provider: Provider
  constructor(provider: Provider) {
    super(`No ${PROVIDER_LABELS[provider]} API key saved. Add one in AI key settings.`)
    this.name = "MissingKeyError"
    this.provider = provider
  }
}

export class ProviderNotAvailableError extends Error {
  constructor(provider: Provider) {
    super(`${PROVIDER_LABELS[provider]} support is coming in M5. Use OpenAI for now.`)
    this.name = "ProviderNotAvailableError"
  }
}

export type ModelOptions = AiSettings & {
  /** Use this key instead of the stored one, e.g. to test a key before saving it. */
  apiKey?: string
  /** Custom fetch, for tests that intercept the request. */
  fetch?: typeof globalThis.fetch
}

/**
 * The AI SDK language model for the configured provider and model, with the
 * user's key. Throws MissingKeyError when no key is stored.
 */
export async function getModel(options: ModelOptions = DEFAULT_SETTINGS): Promise<LanguageModel> {
  if (options.provider === "openrouter") throw new ProviderNotAvailableError(options.provider)
  const apiKey = options.apiKey ?? (await getKey(options.provider))
  if (!apiKey) throw new MissingKeyError(options.provider)
  return createModel({ ...options, apiKey })
}

function createModel({ provider, model, apiKey, fetch }: ModelOptions & { apiKey: string }): LanguageModel {
  switch (provider) {
    case "openai":
      // The Responses API: newer OpenAI models require it. OpenAI's API allows
      // CORS for browser calls, so no extra header is needed.
      return createOpenAI({ apiKey, fetch }).responses(model)
    case "anthropic":
      // Anthropic rejects browser (CORS) requests unless this header opts in.
      return createAnthropic({
        apiKey,
        fetch,
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      }).messages(model)
    default:
      throw new ProviderNotAvailableError(provider)
  }
}

/**
 * Per-provider call options. Tool calls run one at a time so patch edits and
 * knob moves apply in the order the model meant. No temperature anywhere:
 * newer OpenAI reasoning models reject it.
 */
export function providerOptionsFor(provider: Provider): Record<string, Record<string, boolean>> {
  switch (provider) {
    case "openai":
      return { openai: { parallelToolCalls: false } }
    case "anthropic":
      return { anthropic: { disableParallelToolUse: true } }
    default:
      return {}
  }
}

/**
 * Check a key with the smallest real request the provider takes (a few output
 * tokens). Resolves when the provider accepts the key and model; rejects with
 * the provider's message otherwise.
 */
export async function testKey(settings: AiSettings, apiKey: string, signal?: AbortSignal): Promise<void> {
  const model = await getModel({ ...settings, apiKey })
  await generateText({
    model,
    prompt: "Reply with OK.",
    // OpenAI's Responses API takes no fewer than 16.
    maxOutputTokens: 16,
    maxRetries: 0,
    abortSignal: signal,
  })
}

/** A short, key-free message for a provider error, for status readouts. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 401 || status === 403) return "Key rejected by the provider (unauthorised)."
    if (status === 404) return "Model not found for this key."
    if (status === 429) return "Rate limited or out of credit. Try again shortly."
    if (error.name === "AbortError") return "Stopped."
    return error.message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-…")
  }
  return String(error)
}
