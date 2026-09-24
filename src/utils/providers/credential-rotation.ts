import type { LLMProviderConfig } from "@/types/config/provider"
import { resolveModelId } from "@/utils/providers/model-id"
import {
  getRequestErrorMeta,
  getRetryAfterMs,
  isRateLimitRequestError,
} from "@/utils/request/retry-policy"
import {
  isProviderCoolingDown,
  markProviderCoolingDown,
  type ProviderFailureKind,
  soonestCooldownRecoveryMs,
} from "./provider-cooldown"

/**
 * Credential-level rotation inside ONE provider: the extra API keys
 * (`apiKeys`) and extra models (`model.rotationModels`) the user added so a
 * single key's per-minute budget (or a single model's quota) is not the whole
 * provider's.
 *
 * Keys and models rotate independently — each request takes the next available
 * key and the next available model — and a refused credential is parked for a
 * while (via the same mechanics as `provider-cooldown`, keyed by a composite
 * id) so subsequent requests skip it. When every credential of a dimension is
 * cooling, `pickNextCredential` returns null and the caller hands the queue a
 * rate-limit error widened to the first recovery, exactly like the
 * provider-level rotation does when the whole fleet is cooling.
 *
 * In-memory like the provider cooldowns: a credential cooldown that survived a
 * service-worker restart would outlive whatever quota window it described, and
 * a config edit clears everything (`clearProviderCooldown`) so a key the user
 * just fixed is back on the next request.
 */

export interface RotatedCredential {
  apiKey?: string
  modelId?: string
}

export interface CredentialFailure {
  reason: ProviderFailureKind
  retryAfterMs?: number
}

/**
 * Per-provider rotating cursors, one for keys and one for models. Translation
 * requests run on the same JS thread, so the increments are atomic with
 * respect to dispatch — same reasoning as the feature-level round robin.
 */
const keyRoundRobinCounters = new Map<string, number>()
const modelRoundRobinCounters = new Map<string, number>()

/**
 * Credential cooldowns share the provider cooldown maps under composite ids.
 * Provider ids are generated, so the prefixes cannot collide with a real
 * provider, and the shared implementation brings the backoff doubling, the
 * Retry-After honoring, the cap and the self-expiry for free. The config
 * watcher (translation-queues) also clears through these ids when a provider
 * row is edited, so a fixed key/model is back on the next request.
 */
export const apiKeyCooldownId = (providerId: string, apiKey: string) =>
  `api-key\u0000${providerId}\u0000${apiKey}`
export const modelIdCooldownId = (providerId: string, modelId: string) =>
  `model\u0000${providerId}\u0000${modelId}`

/** The primary `apiKey` plus the extras, trimmed, deduped, in config order. */
export function listProviderApiKeys(providerConfig: LLMProviderConfig): string[] {
  return dedupePreserveOrder([providerConfig.apiKey, ...(providerConfig.apiKeys ?? [])])
}

/** The selected/custom model id plus the rotation extras, trimmed, deduped. */
export function listProviderModelIds(providerConfig: LLMProviderConfig): string[] {
  return dedupePreserveOrder([
    providerConfig.model ? resolveModelId(providerConfig.model) : undefined,
    ...(providerConfig.model?.rotationModels ?? []),
  ])
}

function dedupePreserveOrder(values: (string | undefined)[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function availableCredentialLists(providerConfig: LLMProviderConfig) {
  const providerId = providerConfig.id
  const apiKeys = listProviderApiKeys(providerConfig)
  const modelIds = listProviderModelIds(providerConfig)
  const availableApiKeys = apiKeys.filter(
    (apiKey) => !isProviderCoolingDown(apiKeyCooldownId(providerId, apiKey)),
  )
  const availableModelIds = modelIds.filter(
    (modelId) => !isProviderCoolingDown(modelIdCooldownId(providerId, modelId)),
  )
  return { apiKeys, modelIds, availableApiKeys, availableModelIds }
}

/**
 * Whether at least one key and one model can still take a request. A dimension
 * with NO credentials configured is always available (the request just goes
 * out without one); a dimension with credentials is exhausted only when every
 * one of them is cooling.
 */
export function hasAvailableCredential(providerConfig: LLMProviderConfig): boolean {
  const { apiKeys, modelIds, availableApiKeys, availableModelIds } =
    availableCredentialLists(providerConfig)
  if (apiKeys.length > 0 && availableApiKeys.length === 0) return false
  if (modelIds.length > 0 && availableModelIds.length === 0) return false
  return true
}

/**
 * The next key/model pair to serve a request with, advancing both rotations
 * and skipping cooling credentials. Null when a configured dimension is fully
 * cooling — the caller should wait rather than pay for another rejection.
 */
export function pickNextCredential(providerConfig: LLMProviderConfig): RotatedCredential | null {
  const providerId = providerConfig.id
  const { availableApiKeys, availableModelIds } = availableCredentialLists(providerConfig)
  if (!hasAvailableCredential(providerConfig)) return null

  return {
    apiKey:
      availableApiKeys.length > 0
        ? nextInRoundRobin(keyRoundRobinCounters, providerId, availableApiKeys)
        : undefined,
    modelId:
      availableModelIds.length > 0
        ? nextInRoundRobin(modelRoundRobinCounters, providerId, availableModelIds)
        : undefined,
  }
}

function nextInRoundRobin(
  counters: Map<string, number>,
  providerId: string,
  values: string[],
): string {
  const prev = counters.get(providerId) ?? -1
  const next = (prev + 1) % values.length
  counters.set(providerId, next)
  return values[next]!
}

/**
 * Park the key AND the model that just refused. A 429 is a property of the
 * key's budget, but models can carry their own quota too, and the user added
 * rotation lists precisely so the refused combination stops being retried —
 * over-parking costs at most one self-expiring window.
 */
export function markCredentialCoolingDown(
  providerConfig: LLMProviderConfig,
  credential: RotatedCredential,
  kind: ProviderFailureKind,
  retryAfterMs?: number,
): void {
  const providerId = providerConfig.id
  if (credential.apiKey) {
    markProviderCoolingDown(apiKeyCooldownId(providerId, credential.apiKey), kind, retryAfterMs)
  }
  if (credential.modelId) {
    markProviderCoolingDown(modelIdCooldownId(providerId, credential.modelId), kind, retryAfterMs)
  }
}

/**
 * What a failure says about the credential that produced it, or nothing when
 * it says nothing about that: a timeout, a malformed batch response or a
 * cancellation are not properties of the key or model, so re-sending them on
 * another credential would only double the bill.
 */
export function classifyCredentialFailure(error: unknown): CredentialFailure | null {
  const meta = getRequestErrorMeta(error)
  if (isRateLimitRequestError(error)) {
    return { reason: "rate-limit", retryAfterMs: getRetryAfterMs(meta) }
  }
  // A rejected key, model or tier: every queued sibling would fail identically
  // on THIS credential, which is exactly what makes it worth asking the next.
  if (
    meta.kind === "access-denied" ||
    meta.statusCode === 401 ||
    meta.statusCode === 403 ||
    meta.statusCode === 404
  ) {
    return { reason: "access-denied" }
  }
  return null
}

/**
 * ms until the next request to this provider can go out, counting only the
 * dimensions that are fully cooling — a provider with one live model is usable
 * right now even if every key is parked (the caller pairs credentials, so a
 * live dimension means `pickNextCredential` can return a pair). 0 when
 * nothing needs waiting for.
 */
export function credentialCooldownRecoveryMs(providerConfig: LLMProviderConfig): number {
  const providerId = providerConfig.id
  const exhaustedCooldownIds: string[] = []

  const apiKeys = listProviderApiKeys(providerConfig)
  if (apiKeys.length > 0) {
    const keyIds = apiKeys.map((apiKey) => apiKeyCooldownId(providerId, apiKey))
    if (keyIds.every((id) => isProviderCoolingDown(id))) {
      exhaustedCooldownIds.push(...keyIds)
    }
  }

  const modelIds = listProviderModelIds(providerConfig)
  if (modelIds.length > 0) {
    const modelCooldownIds = modelIds.map((modelId) => modelIdCooldownId(providerId, modelId))
    if (modelCooldownIds.every((id) => isProviderCoolingDown(id))) {
      exhaustedCooldownIds.push(...modelCooldownIds)
    }
  }

  return soonestCooldownRecoveryMs(exhaustedCooldownIds)
}
