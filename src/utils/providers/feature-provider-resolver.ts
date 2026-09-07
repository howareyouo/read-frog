import type { Config } from "@/types/config/config"
import { isLLMProviderConfig } from "@/types/config/provider"
import type { FeatureKey } from "@/utils/constants/feature-providers"
import {
  getFeatureProviderIds,
  resolveProviderConfigOrNull,
} from "@/utils/constants/feature-providers"
import { filterCoolingDownProviders } from "@/utils/providers/provider-cooldown"
import {
  doesProviderSupportsCapability,
  type ProviderRefForCapability,
  resolveProviderRefForCapability,
} from "./provider-registry"

/**
 * Per-feature rotating cursor. A single in-memory counter per feature is enough:
 * translation requests arrive on the same JS thread, so the increment is atomic
 * with respect to request dispatch, and distributing load across the selected
 * providers does not require persistence.
 */
const roundRobinCounters = new Map<FeatureKey, number>()

/** Per-config-object memo for getFeatureProviderSetCacheIdentity (see there). */
const setCacheIdentityMemos = new WeakMap<Config, Map<FeatureKey, string>>()

/**
 * The selected ids that can actually serve the feature right now (enabled + capability match).
 * Exported so status UIs report on the same set the rotation will dispatch to.
 */
export function getUsableFeatureProviderIds(config: Config, featureKey: FeatureKey): string[] {
  const all = getFeatureProviderIds(config, featureKey)
  return all.filter((id) =>
    doesProviderSupportsCapability(featureKey, config.providersConfig, id, { requireEnable: true }),
  )
}

/** Advance and return the index of the next provider to use, cycling through `length`. */
export function nextFeatureProviderIndex(featureKey: FeatureKey, length: number): number {
  if (length <= 0) return -1
  const prev = roundRobinCounters.get(featureKey) ?? -1
  const next = (prev + 1) % length
  roundRobinCounters.set(featureKey, next)
  return next
}

/** Whether any selected provider can serve the feature right now — pure check, does not advance the rotation. */
export function hasUsableFeatureProvider(config: Config, featureKey: FeatureKey): boolean {
  return getUsableFeatureProviderIds(config, featureKey).length > 0
}

/**
 * Cache identity for a feature's full provider SET, stable across the
 * per-request rotation. Request hashes must not embed whichever provider the
 * rotation happened to pick: the rotation sequence depends on call order and
 * call count, which differ between the first translation run (scroll-driven,
 * mixed with the title request and skip checks) and every re-run after a
 * 原文/译文 toggle or virtualized remount (all-at-once, DOM order). With
 * per-instance identity those re-runs hash differently, miss both cache
 * tiers, and re-hit the provider APIs for text translated moments ago.
 *
 * Keying on the ordered set of usable provider configs keeps one cache entry
 * per logical request while preserving invalidation: editing a provider's
 * config, adding/removing one from the selection, or toggling its enabled
 * flag all change the serialized set.
 */
export function getFeatureProviderSetCacheIdentity(
  config: Config,
  featureKey: FeatureKey,
): string | null {
  // One stringify per config object, not per translated paragraph — the
  // resolved config object identity is stable until a config change (see
  // getCachedConfig), which produces a fresh object and a fresh entry.
  let byFeature = setCacheIdentityMemos.get(config)
  if (byFeature === undefined) {
    byFeature = new Map()
    setCacheIdentityMemos.set(config, byFeature)
  }
  const memoized = byFeature.get(featureKey)
  if (memoized !== undefined) return memoized

  const ids = getUsableFeatureProviderIds(config, featureKey)
  if (ids.length === 0) return null
  const configs = ids.map((id) => {
    const ref = resolveProviderRefForCapability(featureKey, config.providersConfig, id)
    if (!ref) {
      throw new Error(`No ${featureKey} provider config for id "${id}"`)
    }
    return ref.config
  })
  const identity = JSON.stringify(configs)
  byFeature.set(featureKey, identity)
  return identity
}

/** The primary (first) provider for a feature — used for summaries and non-request contexts. */
export function getPrimaryFeatureProviderRef(
  featureKey: FeatureKey,
  config: Config,
): ProviderRefForCapability<FeatureKey> | null {
  const id = getFeatureProviderIds(config, featureKey)[0] ?? ""
  if (!id) return null
  return resolveProviderRefForCapability(featureKey, config.providersConfig, id)
}

/**
 * Resolve the next provider in rotation for a feature's translation request.
 * Returns null when no selected provider can serve the feature (disabled or
 * capability mismatch). Selection is round-robin so load spreads across the
 * chosen interfaces.
 */
export function resolveFeatureProviderRefForRequest(
  featureKey: FeatureKey,
  config: Config,
): ProviderRefForCapability<FeatureKey> | null {
  const ids = getUsableFeatureProviderIds(config, featureKey)
  if (ids.length === 0) return null
  const index = nextFeatureProviderIndex(featureKey, ids.length)
  return resolveProviderRefForCapability(featureKey, config.providersConfig, ids[index]!)
}

/** The usable providers that can take a prompt, i.e. the ones smart context can reach. */
export function getUsableLLMFeatureProviderIds(config: Config, featureKey: FeatureKey): string[] {
  return getUsableFeatureProviderIds(config, featureKey).filter((id) => {
    const provider = config.providersConfig.find((entry) => entry.id === id)
    return provider !== undefined && isLLMProviderConfig(provider)
  })
}

/** Whether at least one selected provider that can serve the feature is an LLM provider. */
export function hasUsableLLMFeatureProvider(config: Config, featureKey: FeatureKey): boolean {
  return getUsableLLMFeatureProviderIds(config, featureKey).length > 0
}

/**
 * The provider a feature's summary is generated with. Summaries are built once per page or video
 * by the feature's *first* selected provider — see `resolvePageTranslationProvider` and
 * `resolveSubtitlesProviderRef`, which read the primary id and ignore whether later providers in
 * the rotation could be prompted — so smart context only reaches a feature when that one can.
 */
export function isPrimaryFeatureProviderLLM(config: Config, featureKey: FeatureKey): boolean {
  const primary = resolveProviderConfigOrNull(config, featureKey)
  return primary !== null && isLLMProviderConfig(primary)
}

/**
 * Resolve the next LLM provider in rotation for a feature. Used where batches
 * are composed provider-agnostically and the provider is only picked when the
 * whole batch is about to be sent (per-batch rotation still spreads load, but
 * every request leaves fully loaded). `requireLLM` narrows to LLM providers so
 * the caller never receives a provider that cannot take a batched prompt.
 * Returns null when no qualifying provider is enabled.
 *
 * Providers the fleet is currently cooling down from a 429 or a hard denial are
 * skipped — that is the whole point of selecting several — and `excludeIds`
 * lets one caller rule out the ones it has already burned inside a single
 * request. When every candidate is cooling, this returns null rather than
 * handing back a provider known to refuse: the caller waits instead of paying
 * for another rejection.
 */
export function resolveRotatingProviderRefForFeature(
  featureKey: FeatureKey,
  config: Config,
  {
    requireLLM = true,
    excludeIds,
  }: { requireLLM?: boolean; excludeIds?: ReadonlySet<string> } = {},
): ProviderRefForCapability<FeatureKey> | null {
  let ids = getUsableFeatureProviderIds(config, featureKey)
  if (requireLLM) {
    ids = ids.filter((id) =>
      isLLMProviderConfig(config.providersConfig.find((provider) => provider.id === id)!),
    )
  }
  if (excludeIds?.size) {
    ids = ids.filter((id) => !excludeIds.has(id))
  }
  if (ids.length === 0) return null
  const available = filterCoolingDownProviders(ids)
  if (available.length === 0) return null
  const index = nextFeatureProviderIndex(featureKey, available.length)
  return resolveProviderRefForCapability(featureKey, config.providersConfig, available[index]!)
}
