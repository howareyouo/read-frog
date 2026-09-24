import type { Config } from "@/types/config/config"
import type { TranslateProviderConfig } from "@/types/config/provider"
import { isLLMProviderConfig } from "@/types/config/provider"
import {
  getFeatureProviderIds,
  getPrimaryFeatureProviderId,
} from "@/utils/constants/feature-providers"
import { resolveFeatureProviderRefForRequest } from "./feature-provider-resolver"
import { resolveProviderRefForCapability } from "./provider-registry"

/**
 * A resolved provider with the local wrapper stripped — the provider config
 * itself. Callers unwrap `ResolvedProviderRef` into this because most of them
 * go on to inspect the config directly (`provider !== "deeplx"`,
 * `isLLMProviderConfig`) rather than the ref around it.
 *
 * `TranslateProviderConfig` is the wider of the registry's two capability
 * predicates (`LLMProviderConfig` is a subset of it), so every feature that
 * serializes a ref fits here, including the LLM-only ones. This type therefore
 * does not constrain which provider may run which feature — callers do, by
 * resolving through `resolveProviderRefForCapability` first.
 */
export type UnwrappedProviderRef = TranslateProviderConfig

/**
 * A provider flattened for structured-clone transport to the background.
 * Local providers carry their whole config.
 */
export type SerializableProviderRef = { kind: "local"; config: TranslateProviderConfig }

export function resolvePageTranslationProvider(config: Config): UnwrappedProviderRef {
  const providerId = getPrimaryFeatureProviderId(config, "pageTranslation")
  const resolved = resolveProviderRefForCapability(
    "pageTranslation",
    config.providersConfig,
    providerId,
  )
  if (!resolved) {
    throw new Error(`No page translation provider for id "${providerId}"`)
  }
  return resolved.config
}

/**
 * The next page-translation provider in the feature's round-robin rotation.
 * Used by per-request dispatch (translateTextUsingPageConfig); contexts that
 * need a stable identity across requests — summaries, capability probes —
 * keep `resolvePageTranslationProvider` (primary provider).
 */
export function resolveRotatingPageTranslationProvider(config: Config): UnwrappedProviderRef {
  const resolved = resolveFeatureProviderRefForRequest("pageTranslation", config)
  if (!resolved) {
    throw new Error(
      `No page translation provider for ids "${getFeatureProviderIds(config, "pageTranslation").join(", ")}"`,
    )
  }
  return resolved.config
}

export function resolvePageTranslationProviderOrNull(config: Config): UnwrappedProviderRef | null {
  try {
    return resolvePageTranslationProvider(config)
  } catch {
    return null
  }
}

/**
 * Cache identity for a provider. Local providers hash their whole config, so a
 * changed key or temperature invalidates. One helper so every cache that keys
 * on the provider (page, subtitles, summaries) keys the same way — a local ref
 * still stringifies byte-identically to what those caches used before, so
 * existing BYOK entries survive.
 *
 * Segmentation deliberately does not use it: that feature rotates across every
 * enabled LLM provider, one chunk at a time, so a provider-scoped key made a
 * chunk a cache hit only when the rotation happened to land on the provider
 * that cut it last time. Its cache is keyed on the content alone.
 */
export function getProviderCacheIdentity(ref: SerializableProviderRef): string {
  return JSON.stringify(ref.config)
}

/**
 * Whether this ref can be prompted for free-form text.
 *
 * Capability and promptability are not the same question. A feature's provider
 * list is capability-gated — `videoSubtitles` admits any translate provider —
 * but a summary is a generation, and Google, Microsoft and DeepLX have no model
 * to prompt. Without this, enqueueing a summary for a translate-only subtitles
 * provider is admitted to the queue and can only ever throw, after burning its
 * retries.
 */
export function canProviderRefGenerateText(ref: SerializableProviderRef): boolean {
  return isLLMProviderConfig(ref.config)
}

export function serializeProviderRef(provider: UnwrappedProviderRef): SerializableProviderRef {
  return { kind: "local", config: provider }
}
