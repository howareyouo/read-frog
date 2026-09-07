import type { JSONValue } from "ai"
import { isOpenAICompatibleLLMProvider, supportsTopLevelReasoning } from "@/types/config/provider"
import { LLM_MODEL_OPTIONS } from "../constants/models"

export interface RecommendedProviderOptionsMatch {
  matchIndex: number
  options: Record<string, JSONValue>
}

const OPENAI_COMPATIBLE_OPTION_ALIASES = {
  reasoning_effort: "reasoningEffort",
  verbosity: "textVerbosity",
} as const satisfies Record<string, string>

const REASONING_PROVIDER_OPTION_KEYS = new Set([
  "enableThinking",
  "reasoningEffort",
  "reasoningHistory",
  "thinking",
  "thinkingConfig",
])

function containsOnlyReasoningProviderOptions(options: Record<string, JSONValue>): boolean {
  return (
    Object.keys(options).length > 0 &&
    Object.keys(options).every((key) => REASONING_PROVIDER_OPTION_KEYS.has(key))
  )
}

function normalizeUserProviderOptions(
  provider: string,
  userOptions: Record<string, JSONValue>,
): Record<string, JSONValue> {
  if (!isOpenAICompatibleLLMProvider(provider)) {
    return userOptions
  }

  let changed = false
  const normalizedOptions: Record<string, JSONValue> = { ...userOptions }

  for (const [rawKey, canonicalKey] of Object.entries(OPENAI_COMPATIBLE_OPTION_ALIASES)) {
    if (!(rawKey in normalizedOptions)) {
      continue
    }

    if (!(canonicalKey in normalizedOptions)) {
      normalizedOptions[canonicalKey] = normalizedOptions[rawKey]!
    }

    delete normalizedOptions[rawKey]
    changed = true
  }

  return changed ? normalizedOptions : userOptions
}

/**
 * Detect the recommended provider options for a given model.
 * First match wins - more specific patterns should be placed first in MODEL_OPTIONS.
 */
export function getRecommendedProviderOptionsMatch(
  model: string,
): RecommendedProviderOptionsMatch | undefined {
  for (const [matchIndex, { pattern, options }] of LLM_MODEL_OPTIONS.entries()) {
    if (pattern.test(model)) {
      return { matchIndex, options }
    }
  }
  return undefined
}

/**
 * Get the recommended provider options payload without wrapping it by provider id.
 */
export function getRecommendedProviderOptions(
  model: string,
): Record<string, JSONValue> | undefined {
  return getRecommendedProviderOptionsMatch(model)?.options
}

/**
 * The key `providerOptions` is wrapped under for AI SDK calls.
 * `@ai-sdk/openai-compatible` parses options under the camelCased provider name
 * and deprecates the raw kebab-case one ("openai-compatible" →
 * "openaiCompatible"), so its names are camelCased here; every hosted
 * openai-compatible name is already camel-safe, so only the custom provider's
 * key changes. Other SDK packages (e.g. open-responses) parse only their
 * literal provider name, so those pass through unchanged.
 */
function getProviderOptionsKey(provider: string): string {
  return isOpenAICompatibleLLMProvider(provider)
    ? provider.replace(/[_-]([a-z])/g, (_, char: string) => char.toUpperCase())
    : provider
}

/**
 * Wrap a recommendation for the AI SDK request shape.
 */
export function getProviderOptions(
  model: string,
  provider: string,
): Record<string, Record<string, JSONValue>> {
  const options = getRecommendedProviderOptions(model)
  if (!options) {
    return {}
  }

  return { [getProviderOptionsKey(provider)]: options }
}

/**
 * Get provider options for AI SDK calls.
 * - If the user has saved provider options (including `{}`), use them as-is.
 * - Otherwise fall back to the recommended defaults for the current model.
 */
export function getProviderOptionsWithOverride(
  model: string,
  provider: string,
  userOptions?: Record<string, JSONValue>,
  reasoning?: string,
): Record<string, Record<string, JSONValue>> | undefined {
  if (userOptions !== undefined) {
    return {
      [getProviderOptionsKey(provider)]: normalizeUserProviderOptions(provider, userOptions),
    }
  }

  const recommendedOptions = getRecommendedProviderOptions(model)
  if (!recommendedOptions) {
    return undefined
  }

  if (
    reasoning !== undefined &&
    supportsTopLevelReasoning(provider) &&
    containsOnlyReasoningProviderOptions(recommendedOptions)
  ) {
    return undefined
  }

  return { [getProviderOptionsKey(provider)]: recommendedOptions }
}
