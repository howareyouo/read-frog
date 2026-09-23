import { browser, storage } from "#imports"
import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import { isLLMProviderConfig } from "@/types/config/provider"
import type { BatchQueueConfig, RequestQueueConfig } from "@/types/config/translate"
import { batchQueueConfigSchema } from "@/types/config/translate"
import type { SubtitlePromptContext, WebPagePromptContext } from "@/types/content"
import { putBatchRequestRecord } from "@/utils/batch-request-record"
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "@/utils/constants/config"
import {
  BATCH_SEGMENT_LINE_PATTERN,
  joinBatchSegments,
  normalizeSegmentAnchorEscapes,
} from "@/utils/constants/prompt"
import {
  BATCH_TIMEOUT_PER_CHAR_MS,
  DEFAULT_BATCH_CONFIG,
  MAX_BATCH_TIMEOUT_MS,
} from "@/utils/constants/translate"
import { generateArticleSummary } from "@/utils/content/summary"
import { cleanText } from "@/utils/content/utils"
import { db } from "@/utils/db/dexie/db"
import { Sha256Hex } from "@/utils/hash"
import type { PromptResolver } from "@/utils/host/translate/api/ai"
import { executeTranslate } from "@/utils/host/translate/execute-translate"
import {
  assertHtmlAttributeMarkerIntegrity,
  hasHtmlAttributeMarkerProtocol,
  isHtmlAttributeMarkerIntegrityError,
} from "@/utils/host/translate/html-attribute-markers"
import { normalizePromptContextValue } from "@/utils/host/translate/translate-text"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { getSubtitlesTranslatePrompt } from "@/utils/prompts/subtitles"
import { getTranslatePrompt } from "@/utils/prompts/translate"
import {
  classifyCredentialFailure,
} from "@/utils/providers/credential-rotation"
import {
  getUsableFeatureProviderIds,
  getUsableLLMFeatureProviderIds,
  hasUsableLLMFeatureProvider,
  resolveRotatingProviderRefForFeature,
} from "@/utils/providers/feature-provider-resolver"
import {
  clearProviderCooldown,
  isProviderCoolingDown,
  markProviderCoolingDown,
  soonestCooldownRecoveryMs,
} from "@/utils/providers/provider-cooldown"
import type { SerializableProviderRef } from "@/utils/providers/provider-ref"
import {
  canProviderRefGenerateText,
  getProviderCacheIdentity,
} from "@/utils/providers/provider-ref"
import { BatchCountMismatchError, BatchQueue } from "@/utils/request/batch-queue"
import { CancelledScopeRegistry, TranslationCancelledError } from "@/utils/request/cancellation"
import { RequestQueue } from "@/utils/request/request-queue"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"
import { toFriendlyTranslationErrorMessage } from "@/utils/subtitles/processor/friendly-error"
import { generateTextForProviderRef } from "./background-stream"
import { ensureInitializedConfig } from "./config"

export type QueuedTranslationProvider = ProviderConfig | SerializableProviderRef

function getLocalProviderConfig(provider: QueuedTranslationProvider): ProviderConfig {
  return "kind" in provider ? provider.config : provider
}

async function executeQueuedTranslation<TContext>(
  text: string,
  langConfig: Config["language"],
  provider: QueuedTranslationProvider,
  promptResolver: PromptResolver<TContext>,
  options: {
    isBatch?: boolean
    context?: TContext
    textFormat?: import("@/types/config/translate").TranslationTextFormat
    preserveLineBreaks?: boolean
    signal?: AbortSignal
  } = {},
): Promise<string> {
  return executeTranslate(
    text,
    langConfig,
    getLocalProviderConfig(provider),
    promptResolver,
    options,
  )
}

/**
 * Parse a batch response back to per-segment translations by matching each
 * line-initial `[seg N]` anchor and realigning by N (not by position), so a
 * model that reorders or echoes anchors cannot silently shift translations
 * onto the wrong source texts.
 *
 * - No anchors at all → the model answered a single unanchored input (or
 *   dropped every anchor): return one trimmed segment and let the caller's
 *   count check turn a wrong count into a retry/per-item fallback.
 * - Anchors present but ids are not exactly 0..expectedCount-1 (missing,
 *   duplicated, out-of-range, reordered) → BatchCountMismatchError, same
 *   retry/fallback budget as a count mismatch. A contiguous in-order prefix
 *   (0..k-1) rides along as the error's `partialResults` salvage: the queue
 *   resolves those tasks directly and only re-requests the missing tail.
 */
export function parseBatchResult(result: string, expectedCount: number): string[] {
  const trimmed = normalizeSegmentAnchorEscapes(result).trim()
  const anchorMatches = [...trimmed.matchAll(BATCH_SEGMENT_LINE_PATTERN)]
  if (anchorMatches.length === 0) {
    return [trimmed]
  }

  const byId = new Map<number, string>()
  anchorMatches.forEach((match, index) => {
    const id = Number(match[1])
    if (byId.has(id)) {
      throw new BatchCountMismatchError(expectedCount, anchorMatches.length, [...byId.values()])
    }
    const start = (match.index ?? 0) + match[0].length
    const nextAnchor = anchorMatches[index + 1]
    const end = nextAnchor?.index ?? trimmed.length
    byId.set(id, trimmed.slice(start, end).trim())
  })

  const ids = [...byId.keys()]
  if (ids.length === expectedCount && ids.every((id, index) => id === index)) {
    return Array.from({ length: expectedCount }, (_, id) => byId.get(id)!)
  }

  // Contiguous in-order prefix (seg 0..k-1, k < expected): the common failure
  // is a model merging the last two subtitle cues, which are mid-sentence
  // fragments, into one segment. Those k ids are still correctly aligned, so
  // salvage them and let the queue's fallback re-request only the missing
  // tail — instead of discarding k good translations and re-paying all
  // expectedCount as individual requests. Interior gaps or reordering shift
  // every later segment, so nothing is salvageable there.
  if (ids.length > 0 && ids.length < expectedCount && ids.every((id, index) => id === index)) {
    const salvaged = ids.map((id) => byId.get(id)!)
    throw new BatchCountMismatchError(expectedCount, ids.length, salvaged, salvaged)
  }

  throw new BatchCountMismatchError(
    expectedCount,
    ids.length,
    ids.map((id) => byId.get(id)!),
  )
}

export function shouldUseBatchQueue(provider: QueuedTranslationProvider): boolean {
  return isLLMProviderConfig(getLocalProviderConfig(provider))
}

async function getValidatedCachedTranslation(
  hash: string,
  sourceText: string,
  validateHtmlAttributeMarkers: boolean,
): Promise<string | undefined> {
  const cached = await db.translationCache.get(hash)
  if (!cached) return undefined
  if (!validateHtmlAttributeMarkers) return cached.translation

  try {
    assertHtmlAttributeMarkerIntegrity(sourceText, cached.translation)
    return cached.translation
  } catch (error) {
    if (!isHtmlAttributeMarkerIntegrityError(error)) throw error

    await db.translationCache.delete(hash)
    logger.warn("Deleted cached translation with invalid HTML attribute markers", error)
    return undefined
  }
}

export async function executeBatchTranslation<TContext>(
  dataList: TranslateBatchData<TContext>[],
  provider: QueuedTranslationProvider,
  promptResolver: PromptResolver<TContext>,
  signal?: AbortSignal,
): Promise<string[]> {
  const { langConfig, context } = dataList[0]!
  const texts = dataList.map((d) => d.text)

  const batchText = joinBatchSegments(texts)
  const result = await executeQueuedTranslation(batchText, langConfig, provider, promptResolver, {
    isBatch: true,
    context,
    signal,
  })
  return parseBatchResult(result, dataList.length)
}

/**
 * What a failure says about the credential that produced it, or nothing when
 * it says nothing about that — shared with the credential-level rotation (see
 * `classifyCredentialFailure`): the same taxonomy decides both which provider
 * to fail over to and which key/model to park.
 */
const classifyProviderFailure = classifyCredentialFailure

/**
 * Send one subtitles request across the feature's provider list.
 *
 * The user selected several providers so that one running out of quota is not
 * all of them running out. Until now a 429 only paused the queue and retried
 * the *same* provider — the healthy ones beside it never got a turn, and the
 * video stalled on one key's cooldown. Each refusal parks its provider for a
 * while (see `provider-cooldown`), so every retry lands somewhere else, and
 * only once the whole list has refused does the error reach the queue and pause
 * it — widened to the first recovery in the fleet rather than the last
 * provider's own guess.
 *
 * `seed` is the provider the batch was assigned at flush time; it keeps the
 * "one provider per batch" property for the common (successful) case.
 */
export async function executeWithProviderFailover<T>(args: {
  config: Config
  requireLLM: boolean
  seed?: QueuedTranslationProvider | null
  signal?: AbortSignal
  run: (provider: QueuedTranslationProvider) => Promise<T>
}): Promise<T> {
  const { config, requireLLM, signal, run } = args
  const candidates = requireLLM
    ? getUsableLLMFeatureProviderIds(config, "videoSubtitles")
    : getUsableFeatureProviderIds(config, "videoSubtitles")
  const tried = new Set<string>()
  let seed = args.seed ?? null
  let lastError: unknown

  for (;;) {
    let provider: QueuedTranslationProvider | null = null
    if (seed) {
      const seedId = getLocalProviderConfig(seed).id
      if (!tried.has(seedId) && !isProviderCoolingDown(seedId)) {
        provider = seed
      }
      seed = null
    }
    provider ??= resolveRotatingProviderRefForFeature("videoSubtitles", config, {
      requireLLM,
      excludeIds: tried,
    })
    if (!provider) break

    const providerId = getLocalProviderConfig(provider).id
    tried.add(providerId)
    try {
      const result = await run(provider)
      // Proof of recovery: drop the backoff this provider accumulated earlier.
      clearProviderCooldown(providerId)
      return result
    } catch (error) {
      const failure = classifyProviderFailure(error)
      if (!failure) throw error
      markProviderCoolingDown(providerId, failure.reason, failure.retryAfterMs)
      lastError = error
    }

    // A cancelled or aborted round must not spend another provider.
    if (signal?.aborted) throw lastError
  }

  if (lastError === undefined) {
    const recoveryMs = soonestCooldownRecoveryMs(candidates)
    if (candidates.length > 0 && recoveryMs > 0) {
      // Nothing selectable, but only because the fleet is cooling: hand the
      // queue a rate-limit error so it waits for the first recovery instead of
      // failing the batch (and, for 401s, draining everything behind it).
      throw attachRequestErrorMeta(new Error("All subtitles providers are cooling down"), {
        kind: "rate-limit",
        retryAfterMs: recoveryMs,
      })
    }
    throw new Error("No subtitles translation provider available")
  }

  // Widened over the whole candidate list, not just the providers this request
  // happened to burn: if another one is free in 2s, the queue should be back to
  // work in 2s.
  const recoveryMs = soonestCooldownRecoveryMs(candidates)
  if (recoveryMs > 0) {
    const error = lastError instanceof Error ? lastError : new Error(String(lastError))
    // The first recovery in the fleet, not the last provider's own window: the
    // retry that follows the pause will be routed to whichever one is back.
    throw attachRequestErrorMeta(error, { retryAfterMs: recoveryMs })
  }
  throw lastError
}

/**
 * One cached, queued summary generation for both the page summary and the
 * video summary. The two were byte-for-byte identical apart from which parts
 * went into the cache key, so the key parts are the parameter and everything
 * else — the double-check inside the thunk, the empty-string sentinel that
 * keeps a failed generation from being cached as a hit, the queue admission —
 * is shared.
 */
async function getOrGenerateSummary(args: {
  title: string
  textContent: string
  providerRef: SerializableProviderRef
  cacheKeyParts: string[]
  requestQueue: RequestQueue
}): Promise<string | null> {
  const { title, textContent, providerRef, cacheKeyParts, requestQueue } = args
  const preparedText = cleanText(textContent)
  if (!preparedText) {
    return null
  }

  const cacheKey = Sha256Hex(...cacheKeyParts, getProviderCacheIdentity(providerRef))

  const cached = await db.articleSummaryCache.get(cacheKey)
  if (cached) {
    logger.info("Using cached summary")
    return cached.summary
  }

  const thunk = async (signal?: AbortSignal) => {
    const cachedAgain = await db.articleSummaryCache.get(cacheKey)
    if (cachedAgain) {
      return cachedAgain.summary
    }

    const summary = await generateArticleSummary(title, textContent, providerRef, {
      signal,
      generate: (payload, runOptions) => generateTextForProviderRef(payload, runOptions),
    })
    if (!summary) {
      return ""
    }

    await db.articleSummaryCache.put({
      key: cacheKey,
      summary,
      createdAt: new Date(),
    })

    logger.info("Generated and cached new summary")
    return summary
  }

  try {
    const summary = await requestQueue.enqueue(thunk, Date.now(), cacheKey)
    return summary || null
  } catch (error) {
    logger.warn("Failed to get/generate summary:", error)
    return null
  }
}

export interface TranslateBatchData<TContext = unknown> {
  text: string
  langConfig: Config["language"]
  /**
   * Absent for subtitles: those items are enqueued provider-agnostically and
   * the provider is picked once per batch at flush time (`meta.provider`),
   * so a batch composes across look-ahead windows instead of being split per
   * provider. Webpage items still resolve their provider up front.
   */
  provider?: QueuedTranslationProvider
  hash: string
  scheduleAt: number
  context?: TContext
  // Cancellation scope (`${tabId}:${sessionId}`); absent = uncancellable.
  scope?: string
  // Absolute ms timestamp when the content is needed (subtitle cues: playback
  // start). Only subtitles set it; a below-min batch holds until its earliest
  // deadline nears instead of force-flushing at batchDelay.
  dueAt?: number
}

/**
 * Compose the cancellation scope from the message sender and the content
 * script's session id. Building it background-side from `sender.tab.id` makes
 * cross-tab cancellation impossible by construction.
 */
export function buildTranslationScopeKey(
  sender: { tab?: { id?: number } } | undefined,
  sessionId: string | undefined,
): string | undefined {
  const tabId = sender?.tab?.id
  return typeof tabId === "number" && sessionId ? `${tabId}:${sessionId}` : undefined
}

interface TranslationQueueSetupConfig<TContext = unknown> {
  requestQueueConfig: RequestQueueConfig
  batchQueueConfig: BatchQueueConfig
  promptResolver: PromptResolver<TContext>
  // Present only for queues whose requests carry cancellation scopes.
  isScopeCancelled?: (scopeKey: string) => boolean
  queueName: "webpage" | "subtitles"
  // "default" means the user's stored config could not be loaded — the queue
  // is running on DEFAULT_CONFIG values (rate 8 / capacity 20), NOT what the
  // options page shows. Logged loudly so support reports are diagnosable.
  configSource: "user" | "default"
  // Batch-level retry budget for count-mismatch (LLM returned the wrong number
  // of lines). Subtitles run a tighter budget than page translation so a bad
  // batch falls back to per-cue sends (or blanks just its window) instead of
  // burning 1+2+4s of backoff in the user's face (P5).
  maxRetries?: number
}

/**
 * The BatchQueue runs with `batchDelay` in milliseconds; the config/UI layer
 * carries it in seconds. Raw storage values reach this boundary unparsed, so
 * validate before trusting them.
 */
interface BatchQueueRuntimeConfig {
  maxCharactersPerBatch: number
  maxItemsPerBatch: number
  minItemsPerBatch: number
  batchDelay: number
}

function toBatchQueueRuntimeConfig(config: BatchQueueConfig): BatchQueueRuntimeConfig {
  const parsed = batchQueueConfigSchema.safeParse(config)
  if (!parsed.success) {
    logger.error(
      "[translation-queues] invalid batchQueueConfig, falling back to defaults",
      parsed.error.issues,
    )
    return {
      ...DEFAULT_BATCH_CONFIG,
      batchDelay: DEFAULT_BATCH_CONFIG.batchDelay * 1000,
    }
  }
  const { batchDelay, ...rest } = parsed.data
  return { ...rest, batchDelay: batchDelay * 1000 }
}

async function createTranslationQueues<TContext>(config: TranslationQueueSetupConfig<TContext>) {
  const { rate, capacity } = config.requestQueueConfig
  const batchQueueRuntimeConfig = toBatchQueueRuntimeConfig(config.batchQueueConfig)
  const { promptResolver, isScopeCancelled, queueName, configSource, maxRetries } = config

  logger.info(`[translation-queues] ${queueName} queue init`, {
    rate,
    capacity,
    ...batchQueueRuntimeConfig,
    configSource,
  })
  if (configSource === "default") {
    logger.error(
      `[translation-queues] ${queueName} queue running on DEFAULT config (rate ${rate}, capacity ${capacity}) — user config unavailable at init`,
    )
  }

  const requestQueue = new RequestQueue({
    rate,
    capacity,
    timeoutMs: 30_000,
    maxRetries: 2,
    baseRetryDelayMs: 1_000,
  })
  const batchQueue = new BatchQueue<TranslateBatchData<TContext>, string>({
    ...batchQueueRuntimeConfig,
    maxRetries: maxRetries ?? 3,
    enableFallbackToIndividual: true,
    // Narrow port, not the whole queue: batches that reached minItemsPerBatch
    // keep filling to maxItems/maxChars while the limiter has no free slot
    // (flushing early would only freeze their composition); below-min batches
    // ignore the gate and flush at batchDelay.
    dispatchGate: { nextDispatchEtaMs: () => requestQueue.nextDispatchEtaMs() },
    getBatchKey: (data) => {
      // Subtitle items are enqueued WITHOUT a provider and the provider is
      // picked at flush time, so the key must be provider-agnostic — cues from
      // consecutive look-ahead windows have to land in the same pending batch
      // to compose. Webpage items still carry their own provider and group by
      // it (their per-item cache hashes are provider-specific, so a mixed batch
      // would send text to a provider it was not keyed for).
      const providerIdentity =
        queueName === "subtitles" ? "" : getLocalProviderConfig(data.provider!).id
      return Sha256Hex(
        `${data.langConfig.sourceCode}-${data.langConfig.targetCode}-${providerIdentity}`,
        data.context ? JSON.stringify(data.context) : "",
      )
    },
    getCharacters: (data) => data.text.length,
    getDedupKey: (data) => data.hash,
    getScope: (data) => data.scope,
    // Webpage tasks never set dueAt (undefined here) — only the subtitles
    // queue's below-min batches get the deadline-based hold.
    getBatchDueAt: (data) => data.dueAt,
    isScopeCancelled,
    resolveBatchProvider:
      queueName === "subtitles"
        ? async () => {
            const config = await ensureInitializedConfig()
            if (!config) {
              return undefined
            }
            return resolveRotatingProviderRefForFeature("videoSubtitles", config, {
              requireLLM: true,
            })
          }
        : undefined,
    executeBatch: async (dataList, meta) => {
      // Subtitles: picked per batch at flush time as the *seed*, so the whole
      // batch (and its per-item fallbacks) normally goes to ONE provider — and
      // moves to the next one in the list when that provider refuses.
      // Webpage: falls through to the per-item provider the content script
      // resolved, which its cache key was built for, so it never rotates.
      const seedProvider = ((await meta.provider) ?? dataList[0]!.provider) as
        | QueuedTranslationProvider
        | undefined
      if (queueName !== "subtitles" && !seedProvider) {
        throw new Error("No translation provider available for batch")
      }
      const hash = Sha256Hex(...dataList.map((d) => d.hash))
      const earliestScheduleAt = Math.min(...dataList.map((d) => d.scheduleAt))
      const totalCharacters = dataList.reduce((sum, d) => sum + d.text.length, 0)
      const timeoutMs = Math.min(
        30_000 + totalCharacters * BATCH_TIMEOUT_PER_CHAR_MS,
        MAX_BATCH_TIMEOUT_MS,
      )

      const batchThunk = async (signal?: AbortSignal): Promise<string[]> => {
        const send = async (provider: QueuedTranslationProvider) => {
          await putBatchRequestRecord({
            originalRequestCount: dataList.length,
            providerConfig: getLocalProviderConfig(provider),
          })
          return await executeBatchTranslation(dataList, provider, promptResolver, signal)
        }
        if (queueName !== "subtitles") {
          return await send(seedProvider!)
        }
        const config = await ensureInitializedConfig()
        if (!config) {
          throw new Error("Config unavailable for subtitles translation")
        }
        return await executeWithProviderFailover({
          config,
          requireLLM: true,
          seed: seedProvider,
          signal,
          run: send,
        })
      }

      // Earliest cue deadline → request-queue priority, so a batch whose cues
      // are about to play jumps ahead of far-future prefetched batches (P7).
      const dueAts = dataList
        .map((d) => d.dueAt)
        .filter((value): value is number => value !== undefined)
      const earliestDueAt = dueAts.length > 0 ? Math.min(...dueAts) : undefined

      return requestQueue.enqueue(batchThunk, earliestScheduleAt, hash, meta.scopes, {
        timeoutMs,
        dueAt: earliestDueAt,
      })
    },
    executeIndividual: async (data, meta) => {
      const { text, langConfig, hash, scheduleAt, context, scope } = data
      const seedProvider = ((await meta.provider) ?? data.provider) as QueuedTranslationProvider
      const thunk = async (signal?: AbortSignal) => {
        const send = async (provider: QueuedTranslationProvider) => {
          await putBatchRequestRecord({
            originalRequestCount: 1,
            providerConfig: getLocalProviderConfig(provider),
          })
          return executeQueuedTranslation(text, langConfig, provider, promptResolver, {
            context,
            signal,
          })
        }
        if (queueName !== "subtitles") {
          return await send(seedProvider)
        }
        const config = await ensureInitializedConfig()
        if (!config) {
          throw new Error("Config unavailable for subtitles translation")
        }
        return await executeWithProviderFailover({
          config,
          requireLLM: true,
          seed: seedProvider,
          signal,
          run: send,
        })
      }
      return requestQueue.enqueue(thunk, scheduleAt, hash, scope ? [scope] : undefined)
    },
    onError: (error, context) => {
      const errorType = context.isFallback ? "Individual request" : "Batch request"
      logger.error(
        `${errorType} failed (batchKey: ${context.batchKey}, retry: ${context.retryCount}):`,
        error.message,
      )
    },
  })

  return { requestQueue, batchQueue }
}

/**
 * Load the persisted config and build the queues. Never rejects: a broken
 * storage layer degrades to DEFAULT_CONFIG (loudly logged) instead of leaving
 * every translation message rejected.
 */
async function loadQueueSetupConfig(
  queueName: "webpage" | "subtitles",
  selectConfig: (config: Config) => {
    requestQueueConfig: RequestQueueConfig
    batchQueueConfig: BatchQueueConfig
  },
): Promise<{
  requestQueueConfig: RequestQueueConfig
  batchQueueConfig: BatchQueueConfig
  configSource: "user" | "default"
}> {
  let config: Config | null = null
  try {
    config = await ensureInitializedConfig()
  } catch (error) {
    logger.error(`[translation-queues] failed to load config for ${queueName} queue`, error)
  }
  return {
    ...selectConfig(config ?? DEFAULT_CONFIG),
    configSource: config ? "user" : "default",
  }
}

/**
 * Re-apply queue config from storage on every persisted change. This replaces
 * the per-field set*QueueConfig messages: those could be dropped while the SW
 * was cold-starting (handlers used to register only after awaits), silently
 * leaving the live queue on stale values.
 */
function watchQueueConfig(
  queueName: "webpage" | "subtitles",
  queuesPromise: Promise<{
    requestQueue: RequestQueue
    batchQueue: { setBatchConfig: (config: Partial<BatchQueueRuntimeConfig>) => void }
  }>,
  selectConfig: (config: Config) => {
    requestQueueConfig: RequestQueueConfig
    batchQueueConfig: BatchQueueConfig
  },
) {
  let lastAppliedJson: string | null = null
  storage.watch<Config>(`local:${CONFIG_STORAGE_KEY}`, (newConfig) => {
    if (!newConfig) return
    void queuesPromise.then(({ requestQueue, batchQueue }) => {
      try {
        const selected = selectConfig(newConfig)
        const json = JSON.stringify(selected)
        if (json === lastAppliedJson) return
        requestQueue.setQueueOptions(selected.requestQueueConfig)
        batchQueue.setBatchConfig(toBatchQueueRuntimeConfig(selected.batchQueueConfig))
        lastAppliedJson = json
        logger.info(`[translation-queues] ${queueName} queue config updated`, selected)
      } catch (error) {
        logger.error(`[translation-queues] failed to apply ${queueName} queue config change`, error)
      }
    })
  })
}

const selectWebPageQueueConfig = (config: Config) => ({
  requestQueueConfig: config.pageTranslation.requestQueueConfig,
  batchQueueConfig: config.pageTranslation.batchQueueConfig,
})

export function setUpWebPageTranslationQueue(): void {
  // Scopes whose cancel already drained the queues. Consulted by (a) the
  // enqueue handler after its cache-lookup await and (b) the batch queue's
  // retry/fallback path after its backoff sleep — both are windows where a
  // request lives in NO cancellable structure, so a cancel arriving there
  // would otherwise be lost (#1881).
  const cancelledScopes = new CancelledScopeRegistry()

  type WebTranslationPromptContext = WebPagePromptContext

  const webPromptResolver: PromptResolver<WebTranslationPromptContext> = getTranslatePrompt

  const queuesPromise = loadQueueSetupConfig("webpage", selectWebPageQueueConfig).then(
    ({ requestQueueConfig, batchQueueConfig, configSource }) =>
      createTranslationQueues<WebTranslationPromptContext>({
        requestQueueConfig,
        batchQueueConfig,
        promptResolver: webPromptResolver,
        isScopeCancelled: (scopeKey) => cancelledScopes.has(scopeKey),
        queueName: "webpage",
        configSource,
      }),
  )

  // Everything below registers in the FIRST synchronous turn of the SW: an
  // MV3 wake-triggering message can no longer be dropped while init awaits.
  watchQueueConfig("webpage", queuesPromise, selectWebPageQueueConfig)

  onMessage("enqueueTranslateRequest", async (message) => {
    const { requestQueue, batchQueue } = await queuesPromise
    const {
      data: {
        text,
        langConfig,
        providerRef,
        scheduleAt,
        hash,
        textFormat,
        preserveLineBreaks,
        webTitle,
        webDescription,
        webContent,
        webSummary,
        sessionId,
        forceRetranslation = false,
      },
    } = message
    const scope = buildTranslationScopeKey(message.sender, sessionId)

    const validateHtmlAttributeMarkers =
      textFormat === "html" && hasHtmlAttributeMarkerProtocol(text)
    if (validateHtmlAttributeMarkers) {
      assertHtmlAttributeMarkerIntegrity(text, text)
    }

    // Check cache first — unless the user asked for a fresh translation. The
    // existing entry is left untouched unless the fresh request succeeds below.
    if (hash && !forceRetranslation) {
      const cachedTranslation = await getValidatedCachedTranslation(
        hash,
        text,
        validateHtmlAttributeMarkers,
      )
      if (cachedTranslation !== undefined) return cachedTranslation
    }

    // The cache lookup above yielded — the session's cancel may have drained
    // the queues while this handler was suspended. Enqueueing now would park
    // an undraininable task on a dead scope, so abort instead (the content
    // side swallows this error).
    if (scope && cancelledScopes.has(scope)) {
      throw new TranslationCancelledError(scope)
    }

    let result: string
    const context: WebTranslationPromptContext = {
      webTitle: normalizePromptContextValue(webTitle),
      webDescription: normalizePromptContextValue(webDescription),
      webContent: normalizePromptContextValue(webContent),
      webSummary: normalizePromptContextValue(webSummary),
    }

    if (shouldUseBatchQueue(providerRef)) {
      const data = {
        text,
        langConfig,
        provider: providerRef,
        hash,
        scheduleAt,
        context,
        scope,
      }
      result = await batchQueue.enqueue(data)
    } else {
      // Create thunk based on type and params
      const thunk = (signal?: AbortSignal) =>
        executeTranslate(
          text,
          langConfig,
          getLocalProviderConfig(providerRef),
          getTranslatePrompt,
          {
            textFormat,
            preserveLineBreaks,
            signal,
          },
        )
      result = await requestQueue.enqueue(thunk, scheduleAt, hash, scope ? [scope] : undefined)
    }

    if (validateHtmlAttributeMarkers) {
      assertHtmlAttributeMarkerIntegrity(text, result)
    }

    // Cache the translation result if successful
    if (result && hash) {
      await db.translationCache.put({
        key: hash,
        translation: result,
        createdAt: new Date(),
      })
    }

    return result
  })

  onMessage("getOrGenerateWebPageSummary", async (message) => {
    const { requestQueue } = await queuesPromise
    const { webTitle, webContent, providerRef } = message.data

    if (!webTitle || !webContent) {
      return null
    }

    return await getOrGenerateSummary({
      title: webTitle,
      textContent: webContent,
      providerRef,
      cacheKeyParts: [webTitle, Sha256Hex(cleanText(webContent))],
      requestQueue,
    })
  })

  onMessage("cancelPageTranslationRequests", async (message) => {
    const scope = buildTranslationScopeKey(message.sender, message.data.sessionId)
    if (!scope) return
    // Remember the scope BEFORE any await so enqueue handlers suspended on
    // the cache lookup refuse to enqueue after this drain.
    cancelledScopes.markScope(scope)
    const { requestQueue, batchQueue } = await queuesPromise
    // Batch queue first so pending batches cannot flush new request-queue
    // tasks between the two drains.
    const cancelledBatch = batchQueue.cancelByScope(scope)
    const cancelledRequests = requestQueue.cancelByScope(scope)
    if (cancelledBatch + cancelledRequests > 0) {
      logger.info(
        `Cancelled ${cancelledBatch + cancelledRequests} page-translation requests (scope: ${scope})`,
      )
    }
  })

  // A closed tab can never send its cancel message — sweep every scope the
  // tab ever registered (#1881).
  browser.tabs.onRemoved.addListener((tabId) => {
    const prefix = `${tabId}:`
    cancelledScopes.markPrefix(prefix)
    void queuesPromise.then(({ requestQueue, batchQueue }) => {
      batchQueue.cancelWhere((scope) => scope.startsWith(prefix))
      requestQueue.cancelWhere((scope) => scope.startsWith(prefix))
    })
  })
}

/**
 * A provider the user just edited — new key, new model, new endpoint — is a
 * different service as far as a cooldown is concerned. Without this, fixing a
 * typo'd key would still cost up to a minute of being skipped, which reads as
 * "the extension ignores what I just changed".
 */
function watchProviderConfigForCooldownReset(): void {
  let lastProvidersJson: string | null = null
  storage.watch<Config>(`local:${CONFIG_STORAGE_KEY}`, (newConfig) => {
    if (!newConfig?.providersConfig) return
    const json = JSON.stringify(newConfig.providersConfig)
    if (lastProvidersJson !== null && json !== lastProvidersJson) {
      clearProviderCooldown()
    }
    lastProvidersJson = json
  })
}

const selectSubtitlesQueueConfig = (config: Config) => ({
  requestQueueConfig: config.videoSubtitles.requestQueueConfig,
  batchQueueConfig: config.videoSubtitles.batchQueueConfig,
})

/**
 * Set up subtitles translation queue and message handlers
 */
export function setUpSubtitlesTranslationQueue(): void {
  const queuesPromise = loadQueueSetupConfig("subtitles", selectSubtitlesQueueConfig).then(
    ({ requestQueueConfig, batchQueueConfig, configSource }) =>
      createTranslationQueues({
        requestQueueConfig,
        batchQueueConfig,
        promptResolver: getSubtitlesTranslatePrompt,
        queueName: "subtitles",
        maxRetries: 1,
        configSource,
      }),
  )

  watchQueueConfig("subtitles", queuesPromise, selectSubtitlesQueueConfig)
  watchProviderConfigForCooldownReset()

  onMessage("enqueueSubtitlesTranslateBatch", async (message) => {
    const { requestQueue, batchQueue } = await queuesPromise
    const {
      data: { items, langConfig, scheduleAt, webTitle, webDescription, summary },
    } = message

    const context: SubtitlePromptContext = {
      webTitle: normalizePromptContextValue(webTitle),
      webDescription: normalizePromptContextValue(webDescription),
      videoSummary: normalizePromptContextValue(summary),
    }

    // One IndexedDB read for the whole window — the previous per-cue message
    // paid a round trip and a cache read per subtitle, so a burst of cues did
    // N reads before the batch queue ever saw them (P1).
    const hashes = items.map((item) => item.hash)
    const cachedEntries = hashes.length ? await db.translationCache.bulkGet(hashes) : []
    const translations: (string | null)[] = new Array(items.length).fill(null)
    const uncachedIndexes: number[] = []
    for (let i = 0; i < items.length; i++) {
      const cached = cachedEntries[i]
      if (cached) {
        translations[i] = cached.translation
      } else {
        uncachedIndexes.push(i)
      }
    }

    // Everything was cached: no provider call at all.
    if (uncachedIndexes.length === 0) {
      return { translations }
    }

    const config = await ensureInitializedConfig()
    if (!config) {
      throw new Error("Config unavailable for subtitles translation")
    }
    // Batch routing is decided by what the CONFIG can serve, not by a
    // per-message provider: LLM providers take the batch queue (provider picked
    // per batch at flush time), non-LLM services cannot batch and go one cue
    // per request, rotating per cue.
    const useBatchQueue = hasUsableLLMFeatureProvider(config, "videoSubtitles")
    const toCache: { key: string; translation: string; createdAt: Date }[] = []
    let firstErrorMessage: string | undefined

    const translateUncached = async (index: number): Promise<void> => {
      const item = items[index]!
      const dueAt = typeof item.startsInMs === "number" ? Date.now() + item.startsInMs : undefined
      try {
        let result: string
        if (useBatchQueue) {
          // Same context for the whole window → same (provider-agnostic)
          // batchKey → the batch queue composes every uncached cue in this
          // window — and in later windows, until it fills or a cue comes due —
          // into ONE request (P4). The provider is chosen per batch by
          // resolveBatchProvider above.
          result = await batchQueue.enqueue({
            text: item.text,
            langConfig,
            hash: item.hash,
            scheduleAt,
            // Anchor the urgency deadline at receive time so the batch's hold
            // window reflects how long the cue actually has before playback.
            dueAt,
            context,
          })
        } else {
          // Resolved INSIDE the thunk, per attempt: a provider picked at enqueue
          // time would be baked into the closure and re-tried on every retry,
          // which is the same bug the batch path had. The rotation skips
          // providers that are cooling, so a retry lands on a fresh one.
          const thunk = (signal?: AbortSignal) =>
            executeWithProviderFailover({
              config,
              requireLLM: false,
              signal,
              run: (provider) =>
                executeTranslate(
                  item.text,
                  langConfig,
                  getLocalProviderConfig(provider),
                  getSubtitlesTranslatePrompt,
                  { signal },
                ),
            })
          result = await requestQueue.enqueue(thunk, scheduleAt, item.hash, undefined, { dueAt })
        }
        translations[index] = result
        toCache.push({ key: item.hash, translation: result, createdAt: new Date() })
      } catch (error) {
        // A single cue's failure must not blank the whole window: leave its
        // slot null so the UI keeps the cues that succeeded (P5).
        if (firstErrorMessage === undefined) {
          firstErrorMessage = toFriendlyTranslationErrorMessage(error)
        }
      }
    }

    await Promise.all(uncachedIndexes.map(translateUncached))

    if (toCache.length > 0) {
      await db.translationCache.bulkPut(toCache)
    }

    return {
      translations,
      // Only meaningful when every cue failed — the content side shows it then.
      errorMessage: translations.some((t) => t !== null) ? undefined : firstErrorMessage,
    }
  })

  onMessage("getSubtitlesSummary", async (message) => {
    const { requestQueue } = await queuesPromise
    const { videoTitle, subtitlesContext, providerRef } = message.data

    // Guarded on both sides: the content script should not send this for a
    // provider with no model to prompt, and the queue must not admit a task
    // that can only throw if it does.
    if (!videoTitle || !subtitlesContext || !canProviderRefGenerateText(providerRef)) {
      return null
    }

    return await getOrGenerateSummary({
      title: videoTitle,
      textContent: subtitlesContext,
      providerRef,
      // Deliberately without the title, matching the previous key: a video's
      // transcript identifies it, and including a title that players mutate
      // would miss the cache on every re-render.
      cacheKeyParts: [Sha256Hex(cleanText(subtitlesContext))],
      requestQueue,
    })
  })
}
