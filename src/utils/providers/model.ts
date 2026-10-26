import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import type { LLMProviderConfig } from "@/types/config/provider"
import { isOpenAICompatibleLLMProviderConfig } from "@/types/config/provider"
import { createObservedFetch } from "@/utils/request/http-fetch"
import { getLLMProvidersConfig, getProviderConfigById } from "../config/helpers"
import { getLocalConfig } from "../config/storage"
import { getProviderHeadersWithOverride } from "./headers"
import { resolveModelId } from "./model-id"

// Every LLM request leaves through this single observed fetch, so provider
// traffic is logged (method, URL, status, duration) in one place regardless
// of which @ai-sdk/* factory issues it. Streaming responses pass through
// untouched — the wrapper never inspects or rewrites the body.
const LLM_OBSERVED_FETCH = createObservedFetch("LLM")

interface ProviderLike {
  languageModel: (modelId: string) => LanguageModel
}

export async function getLanguageModelById(providerId: string) {
  const config = await getLocalConfig()
  if (!config) {
    throw new Error("Config not found")
  }

  const LLMProvidersConfig = getLLMProvidersConfig(config.providersConfig)
  const providerConfig = getProviderConfigById(LLMProvidersConfig, providerId)
  if (!providerConfig) {
    throw new Error(`Provider ${providerId} not found`)
  }

  return getLanguageModelForConfig(providerConfig)
}

/**
 * Build a model from a config the caller already holds.
 *
 * Callers that were handed a provider config — a transported `providerRef`, say
 * — must use this rather than looking the id up again: re-reading storage picks
 * up edits made after the ref was captured, so the model would come from the
 * new row while the params derived from the ref came from the old one.
 *
 * `credential` lets the credential rotation serve a request with a specific
 * extra key (`apiKeys`) or rotation model instead of the primary ones; absent,
 * the primary `apiKey` / selected model are used exactly as before.
 */
export async function getLanguageModelForConfig(
  providerConfig: LLMProviderConfig,
  credential?: { apiKey?: string; modelId?: string },
): Promise<LanguageModel> {
  const headers = getProviderHeadersWithOverride(providerConfig.provider, providerConfig.headers)

  let provider: ProviderLike
  if (isOpenAICompatibleLLMProviderConfig(providerConfig)) {
    const matchedConfig = providerConfig
    const apiKey = credential?.apiKey ?? matchedConfig.apiKey
    provider = createOpenAICompatible({
      name: matchedConfig.provider,
      baseURL: matchedConfig.baseURL,
      supportsStructuredOutputs: true,
      ...(apiKey && { apiKey }),
      ...(headers && { headers }),
      fetch: LLM_OBSERVED_FETCH,
    })
  } else {
    throw new Error("Unsupported provider config type")
  }

  const modelId = credential?.modelId ?? resolveModelId(providerConfig.model)

  if (!modelId) {
    throw new Error("Model is undefined")
  }

  return provider.languageModel(modelId)
}
