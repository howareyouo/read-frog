import { generateText } from "ai"
import type { LLMProviderConfig } from "@/types/config/provider"
import { getLLMProvidersConfig, getProviderConfigById } from "@/utils/config/helpers"
import { getCachedConfig } from "@/utils/config/storage"
import { extractAISDKErrorMessage } from "@/utils/error/extract-message"
import type { TranslatePromptOptions, TranslatePromptResult } from "@/utils/prompts/translate"
import {
  classifyCredentialFailureOrThrow,
  credentialCooldownRecoveryMs,
  hasAvailableCredential,
  markCredentialCoolingDown,
  pickNextCredential,
  type RotatedCredential,
} from "@/utils/providers/credential-rotation"
import { buildLocalGenerateTextParams } from "@/utils/providers/generate-params"
import { getLanguageModelForConfig } from "@/utils/providers/model"
import {
  attachRequestErrorMeta,
  getRequestErrorMeta,
  rateLimitRequestError,
} from "@/utils/request/retry-policy"

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
      // error carrying the first recovery so it waits instead of failing.
      throw rateLimitRequestError(
        "All API keys and models of this provider are cooling down",
        credentialCooldownRecoveryMs(freshConfig),
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
      const { reason, retryAfterMs } = classifyCredentialFailureOrThrow(error)
      markCredentialCoolingDown(freshConfig, credential, reason, retryAfterMs)
      if (!hasAvailableCredential(freshConfig)) throw error
    }
  }
}

async function getFreshProviderConfig(
  providerConfig: LLMProviderConfig,
): Promise<LLMProviderConfig> {
  try {
    const config = await getCachedConfig()
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
  // The provider options recommendation match must follow the model actually
  // serving this request, not the primary selection.
  const { reasoning, temperature, providerOptions } = buildLocalGenerateTextParams(
    providerConfig,
    credential?.modelId,
  )
  const model = await getLanguageModelForConfig(providerConfig, credential)

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
