import type { Config } from "@/types/config/config"
import type { LanguageDetectionMode } from "@/types/config/language-detection"
import type {
  APIProviderConfig,
  LLMProviderConfig,
  NonAPIProviderConfig,
  ProviderConfig,
  ProvidersConfig,
  PureAPIProviderConfig,
  TranslateProviderConfig,
} from "@/types/config/provider"
import {
  isAPIProviderConfig,
  isLLMProviderConfig,
  isNonAPIProviderConfig,
  isPureAPIProviderConfig,
  isTranslateProviderConfig,
} from "@/types/config/provider"
import type { FeatureKey } from "@/utils/constants/feature-providers"
import { FEATURE_KEYS, FEATURE_PROVIDER_DEFS } from "@/utils/constants/feature-providers"
import { getSelectionToolbarActions, patchSelectionToolbarAction } from "@/utils/custom-actions"
import { getProviderIdsForCapability } from "@/utils/providers/provider-registry"

function getEnabledProviderIdsForCapability(
  capability: FeatureKey | "languageDetection" | "customAction",
  providersConfig: ProvidersConfig,
): string[] {
  return getProviderIdsForCapability(capability, providersConfig, { requireEnable: true })
}

export function getProviderConfigById<T extends ProviderConfig>(
  providersConfig: T[],
  providerId: string,
): T | undefined {
  return providersConfig.find((p) => p.id === providerId)
}

export function getLLMProvidersConfig(providersConfig: ProvidersConfig): LLMProviderConfig[] {
  return providersConfig.filter(isLLMProviderConfig)
}

export function getAPIProvidersConfig(providersConfig: ProvidersConfig): APIProviderConfig[] {
  return providersConfig.filter(isAPIProviderConfig)
}

export function getPureAPIProvidersConfig(
  providersConfig: ProvidersConfig,
): PureAPIProviderConfig[] {
  return providersConfig.filter(isPureAPIProviderConfig)
}

export function getNonAPIProvidersConfig(providersConfig: ProvidersConfig): NonAPIProviderConfig[] {
  return providersConfig.filter(isNonAPIProviderConfig)
}

export function getTranslateProvidersConfig(
  providersConfig: ProvidersConfig,
): TranslateProviderConfig[] {
  return providersConfig.filter(isTranslateProviderConfig)
}

export function filterEnabledProvidersConfig(providersConfig: ProvidersConfig): ProvidersConfig {
  return providersConfig.filter((p) => p.enabled)
}

export function getEnabledLLMProvidersConfig(
  providersConfig: ProvidersConfig,
): LLMProviderConfig[] {
  return filterEnabledProvidersConfig(providersConfig).filter(isLLMProviderConfig)
}

export function getProviderKeyByName(
  providersConfig: ProvidersConfig,
  providerId: string,
): string | undefined {
  const provider = getProviderConfigById(providersConfig, providerId)
  return provider?.provider
}

export function getProviderModelConfig(config: Config, providerId: string) {
  const providerConfig = getProviderConfigById(config.providersConfig, providerId)
  if (providerConfig && isLLMProviderConfig(providerConfig)) {
    return providerConfig.model
  }
  return undefined
}

export function getProviderApiKey(
  providersConfig: ProvidersConfig,
  providerId: string,
): string | undefined {
  const providerConfig = getProviderConfigById(providersConfig, providerId)
  if (providerConfig && isAPIProviderConfig(providerConfig)) {
    return providerConfig.apiKey
  }
  return undefined
}

export function resolveLanguageDetectionConfigForModeChange(
  currentConfig: Config["languageDetection"],
  nextMode: LanguageDetectionMode,
  providersConfig: ProvidersConfig,
): Partial<Config["languageDetection"]> | null {
  if (nextMode === "basic") {
    return { mode: "basic" }
  }

  // Only enabled providers that can run detection count, so LLM mode never
  // arms against a provider that would fail at run time.
  const availableIds = getEnabledProviderIdsForCapability("languageDetection", providersConfig)
  if (availableIds.length === 0) {
    return null
  }

  const hasSelectedProvider =
    currentConfig.providerId !== undefined && availableIds.includes(currentConfig.providerId)
  return {
    mode: "llm",
    providerId: hasSelectedProvider ? currentConfig.providerId : availableIds[0]!,
  }
}

/**
 * Compute fallback provider assignments when a provider is deleted.
 * For each feature still selecting the deleted provider, drops it from the
 * selection; a feature left with an empty selection takes the first remaining
 * enabled provider that can actually run it.
 */
export function computeProviderFallbacksAfterDeletion(
  deletedProviderId: string,
  config: Config,
  remainingProviders: ProvidersConfig,
): Partial<Record<FeatureKey, string[]>> {
  const updates: Partial<Record<FeatureKey, string[]>> = {}
  for (const key of FEATURE_KEYS) {
    const providerIds = FEATURE_PROVIDER_DEFS[key].getProviderIds(config)
    if (!providerIds.includes(deletedProviderId)) continue
    const remaining = providerIds.filter((id) => id !== deletedProviderId)
    updates[key] =
      remaining.length > 0
        ? remaining
        : [getEnabledProviderIdsForCapability(key, remainingProviders)[0]].filter(
            (id): id is string => id !== undefined,
          )
  }
  return updates
}

/**
 * The first feature that would be left with no provider that can actually run
 * it, or null when every feature keeps a working one.
 *
 * Gated on enabled providers, not merely present ones, so the guard actually
 * fires. Features the user has switched off count too: their `providerId` is
 * stored either way, and letting the delete through would leave the slot
 * pointing at a provider that no longer exists.
 */
export function findFeatureMissingProvider(
  remainingProviders: ProvidersConfig,
  config?: Config,
): FeatureKey | "languageDetection" | null {
  for (const key of FEATURE_KEYS) {
    if (!getEnabledProviderIdsForCapability(key, remainingProviders)[0]) {
      return key
    }
  }

  if (
    config?.languageDetection.mode === "llm" &&
    getEnabledProviderIdsForCapability("languageDetection", remainingProviders).length === 0
  ) {
    return "languageDetection"
  }

  return null
}

/**
 * Reassign selection toolbar actions that reference the deleted provider.
 * Fallback target must be the first enabled LLM provider.
 * Returns null when no action is affected or when no fallback exists.
 */
export function computeSelectionToolbarCustomActionFallbacksAfterDeletion(
  deletedProviderId: string,
  config: Config,
  remainingProviders: ProvidersConfig,
): Config["selectionToolbar"] | null {
  const affectedActions = getSelectionToolbarActions(config.selectionToolbar).filter(
    (action) => action.providerId === deletedProviderId,
  )

  if (affectedActions.length === 0) {
    return null
  }

  const fallbackProviderId = getEnabledProviderIdsForCapability(
    "customAction",
    remainingProviders,
  )[0]
  if (!fallbackProviderId) {
    return null
  }

  return affectedActions.reduce(
    (selectionToolbar, action) =>
      patchSelectionToolbarAction(selectionToolbar, action.id, {
        providerId: fallbackProviderId,
      }),
    config.selectionToolbar,
  )
}

/**
 * Compute languageDetection fallback when a provider is deleted.
 * Only applies when mode is "llm" and the deleted provider is the current one.
 * Returns the new providerId (first enabled LLM), or undefined if none available.
 * Returns null when no change is needed.
 */
export function computeLanguageDetectionFallbackAfterDeletion(
  deletedProviderId: string,
  config: Config,
  remainingProviders: ProvidersConfig,
): string | undefined | null {
  if (config.languageDetection.mode !== "llm") return null
  if (config.languageDetection.providerId !== deletedProviderId) return null

  return getEnabledProviderIdsForCapability("languageDetection", remainingProviders)[0]
}
