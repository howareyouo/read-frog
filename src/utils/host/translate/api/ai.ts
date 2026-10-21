import { generateText } from "ai"
import { storage } from "#imports"
import type { Config } from "@/types/config/config"
import type { LLMProviderConfig } from "@/types/config/provider"
import { getLLMProvidersConfig, getProviderConfigById } from "@/utils/config/helpers"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"
import { extractAISDKErrorMessage } from "@/utils/error/extract-message"
import type { TranslatePromptOptions, TranslatePromptResult } from "@/utils/prompts/translate"
import {
  classifyCredentialFailure,
  credentialCooldownRecoveryMs,
  hasAvailableCredential,
  markCredentialCoolingDown,
  pickNextCredential,
  type RotatedCredential,
} from "@/utils/providers/credential-rotation"
import { getLanguageModelForConfig } from "@/utils/providers/model"
import { resolveModelId } from "@/utils/providers/model-id"
import { getProviderOptionsWithOverride } from "@/utils/providers/options"
import { getTopLevelReasoning } from "@/utils/providers/reasoning"
import { attachRequestErrorMeta, getRequestErrorMeta } from "@/utils/request/retry-policy"

const THINK_TAG_RE = /<\/think>([\s\S]*)/

export type PromptResolver<TContext = unknown> = (
  targetLang: string,
  input: string,
  options?: TranslatePromptOptions<TContext>,
) => Promise<TranslatePromptResult>

export interface AITranslateOptions<TContext = unknown> {
  isBatch?: boolean
  context?: TContext
  signal?: AbortSignal
  /**
   * "rotate" (default): serve the request with the next of the provider's
   * credentials — `apiKey` + `apiKeys`, selected model + `rotationModels` —
   * and on a rate limit / hard denial park the refused pair and retry on
   * another one. When every credential is parked the error becomes a
   * rate-limit widened to the first recovery, so the queue waits instead of
   * hammering a spent key.
   *
   * "pinned": one attempt with the config exactly as passed. The direct
   * translate path (connection tests, translation hub) uses this: a test must
   * report on the key/model the user is looking at, not on whichever
   * credential happened to be next.
   */
  credentials?: "rotate" | "pinned"
}

export async function aiTranslate<TContext>(
  text: string,
  targetLangName: string,
  providerConfig: LLMProviderConfig,
  promptResolver: PromptResolver<TContext>,
  options?: AITranslateOptions<TContext>,
) {
  if (options?.credentials === "pinned") {
    return runCredentialAttempt(
      text,
      targetLangName,
      providerConfig,
      undefined,
      promptResolver,
      options,
    )
  }
  return runWithRotatingCredentials(text, targetLangName, providerConfig, promptResolver, options)
}

async function runWithRotatingCredentials<TContext>(
  text: string,
  targetLangName: string,
  providerConfig: LLMProviderConfig,
  promptResolver: PromptResolver<TContext>,
  options?: AITranslateOptions<TContext>,
) {
  // Rotation reads the freshest config: the caller's snapshot may predate a
  // key the user just added (queue refs are captured at enqueue time).
  const freshConfig = await getFreshProviderConfig(providerConfig)

  for (;;) {
    const credential = pickNextCredential(freshConfig)
    if (!credential) {
      // Every configured credential is parked. Hand the queue a rate-limit
      // error carrying the first recovery so it waits instead of failing (or,
      // worse, draining the backlog the way a 401 would).
      throw attachRequestErrorMeta(
        new Error("All API keys and models of this provider are cooling down"),
        { kind: "rate-limit", retryAfterMs: credentialCooldownRecoveryMs(freshConfig) },
      )
    }

    try {
      return await runCredentialAttempt(
        text,
        targetLangName,
        freshConfig,
        credential,
        promptResolver,
        options,
      )
    } catch (error) {
      const failure = classifyCredentialFailure(error)
      // A timeout, a malformed batch response or a cancellation says nothing
      // about the credential — surface it instead of burning the rotation.
      if (!failure) throw error
      markCredentialCoolingDown(freshConfig, credential, failure.reason, failure.retryAfterMs)
      if (!hasAvailableCredential(freshConfig)) throw error
    }
  }
}

async function getFreshProviderConfig(
  providerConfig: LLMProviderConfig,
): Promise<LLMProviderConfig> {
  try {
    const config = await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`)
    const fresh = config
      ? getProviderConfigById(getLLMProvidersConfig(config.providersConfig), providerConfig.id)
      : undefined
    return fresh ?? providerConfig
  } catch {
    return providerConfig
  }
}

async function runCredentialAttempt<TContext>(
  text: string,
  targetLangName: string,
  providerConfig: LLMProviderConfig,
  credential: RotatedCredential | undefined,
  promptResolver: PromptResolver<TContext>,
  options?: AITranslateOptions<TContext>,
) {
  const { provider, providerOptions: userProviderOptions, temperature } = providerConfig
  const reasoning = getTopLevelReasoning(providerConfig)
  // The provider options recommendation match must follow the model actually
  // serving this request, not the primary selection.
  const modelName = credential?.modelId ?? resolveModelId(providerConfig.model)
  const model = await getLanguageModelForConfig(providerConfig, credential)

  const providerOptions = getProviderOptionsWithOverride(
    modelName ?? "",
    provider,
    userProviderOptions,
    reasoning,
  )
  const { systemPrompt, prompt } = await promptResolver(targetLangName, text, options)

  try {
    const { text: translatedText } = await generateText({
      model,
      instructions: systemPrompt,
      prompt,
      reasoning,
      temperature,
      providerOptions,
      abortSignal: options?.signal,
      maxRetries: 0, // Disable SDK built-in retries, let RequestQueue/BatchQueue handle it
    })

    const [, finalTranslation = translatedText] = translatedText.match(THINK_TAG_RE) || []

    return finalTranslation
  } catch (error) {
    const message = extractAISDKErrorMessage(error)
    const meta = getRequestErrorMeta(error)
    if (error instanceof Error) {
      error.message = message
      throw attachRequestErrorMeta(error, meta)
    }

    throw attachRequestErrorMeta(new Error(message), meta)
  }
}
