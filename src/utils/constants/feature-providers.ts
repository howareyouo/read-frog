import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import { isTranslateProvider } from "@/types/config/provider"
import { mergeWithArrayOverwrite } from "../atoms/config"
import { getProviderConfigById } from "../config/helpers"

export const FEATURE_KEYS = [
  "pageTranslation",
  "videoSubtitles",
  "selectionTranslation",
  "inputTranslation",
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

export interface FeatureProviderDef {
  getProviderId: (config: Config) => string
  /** The full set of providers a feature may rotate through. Falls back to `[getProviderId]` when empty. */
  getProviderIds: (config: Config) => string[]
  configPath: readonly string[]
  providerIdsConfigPath: readonly string[]
  isProvider: (provider: string) => boolean
}

export const FEATURE_PROVIDER_DEFS = {
  pageTranslation: {
    isProvider: isTranslateProvider,
    getProviderId: (c: Config) => c.pageTranslation.providerId,
    getProviderIds: (c: Config) => c.pageTranslation.providerIds,
    configPath: ["pageTranslation", "providerId"],
    providerIdsConfigPath: ["pageTranslation", "providerIds"],
  },
  videoSubtitles: {
    isProvider: isTranslateProvider,
    getProviderId: (c: Config) => c.videoSubtitles.providerId,
    getProviderIds: (c: Config) => c.videoSubtitles.providerIds,
    configPath: ["videoSubtitles", "providerId"],
    providerIdsConfigPath: ["videoSubtitles", "providerIds"],
  },
  selectionTranslation: {
    isProvider: isTranslateProvider,
    getProviderId: (c: Config) => c.selectionToolbar.features.translate.providerId,
    getProviderIds: (c: Config) => c.selectionToolbar.features.translate.providerIds,
    configPath: ["selectionToolbar", "features", "translate", "providerId"],
    providerIdsConfigPath: ["selectionToolbar", "features", "translate", "providerIds"],
  },
  inputTranslation: {
    isProvider: isTranslateProvider,
    getProviderId: (c: Config) => c.inputTranslation.providerId,
    getProviderIds: (c: Config) => c.inputTranslation.providerIds,
    configPath: ["inputTranslation", "providerId"],
    providerIdsConfigPath: ["inputTranslation", "providerIds"],
  },
} as const satisfies Record<FeatureKey, FeatureProviderDef>

/**
 * The provider ids a feature will rotate through. `providerIds` is the
 * user-facing multi-select; when it is empty (legacy configs predating
 * multi-select) we fall back to the single `providerId` so dispatch keeps
 * working without a migration.
 */
export function getFeatureProviderIds(config: Config, featureKey: FeatureKey): string[] {
  const ids = FEATURE_PROVIDER_DEFS[featureKey].getProviderIds(config)
  if (ids.length > 0) return ids
  const fallback = FEATURE_PROVIDER_DEFS[featureKey].getProviderId(config)
  return fallback ? [fallback] : []
}

/** The primary provider — first of `providerIds`, or `providerId` when multi-select is empty. */
export function getPrimaryFeatureProviderId(config: Config, featureKey: FeatureKey): string {
  return getFeatureProviderIds(config, featureKey)[0] ?? ""
}

/** Maps FeatureKey (with dots) to i18n-safe key (with underscores) for `options.apiProviders.featureProviders.features.*` */
export const FEATURE_KEY_I18N_MAP = {
  pageTranslation: "pageTranslation",
  videoSubtitles: "videoSubtitles",
  selectionTranslation: "selectionTranslation",
  inputTranslation: "inputTranslation",
} as const satisfies Record<FeatureKey, string>

export type FeatureLabelI18nKey =
  `options.apiProviders.featureProviders.features.${(typeof FEATURE_KEY_I18N_MAP)[FeatureKey]}`

export function getFeatureLabelI18nKey(featureKey: FeatureKey): FeatureLabelI18nKey {
  return `options.apiProviders.featureProviders.features.${FEATURE_KEY_I18N_MAP[featureKey]}`
}

export type FeatureDescriptionI18nKey =
  `options.apiProviders.featureProviders.descriptions.${(typeof FEATURE_KEY_I18N_MAP)[FeatureKey]}`

export function getFeatureDescriptionI18nKey(featureKey: FeatureKey): FeatureDescriptionI18nKey {
  return `options.apiProviders.featureProviders.descriptions.${FEATURE_KEY_I18N_MAP[featureKey]}`
}

export function resolveProviderConfig(config: Config, featureKey: FeatureKey) {
  const providerConfig = resolveProviderConfigOrNull(config, featureKey)
  if (!providerConfig) {
    const providerId = getPrimaryFeatureProviderId(config, featureKey)
    throw new Error(`No provider config for id "${providerId}" (feature "${featureKey}")`)
  }
  return providerConfig
}

export function resolveProviderConfigOrNull(
  config: Config,
  featureKey: FeatureKey,
): ProviderConfig | null {
  const providerId = getPrimaryFeatureProviderId(config, featureKey)
  return getProviderConfigById(config.providersConfig, providerId) ?? null
}

/**
 * Convert a feature→providerId mapping into a Partial<Config> using FEATURE_PROVIDER_DEFS.configPath.
 * Generic — works for any scenario that assigns provider IDs to features.
 */

export function buildFeatureProviderPatch(
  assignments: Partial<Record<FeatureKey, string>>,
): Partial<Config> {
  let patch: Record<string, unknown> = {}

  for (const key of FEATURE_KEYS) {
    const newId = assignments[key]
    if (newId === undefined) continue

    const def = FEATURE_PROVIDER_DEFS[key]

    const fragment: Record<string, unknown> = {}
    let current: Record<string, unknown> = fragment
    for (let i = 0; i < def.configPath.length - 1; i++) {
      const next: Record<string, unknown> = {}
      current[def.configPath[i]!] = next
      current = next
    }
    current[def.configPath[def.configPath.length - 1]!] = newId

    patch = mergeWithArrayOverwrite(patch, fragment)
  }

  return patch
}

/**
 * Like `buildFeatureProviderPatch` but assigns the multi-select `providerIds`
 * array (not the single `providerId`). `providerId` is kept in sync as the
 * first element by the caller so legacy single-provider readers stay valid.
 */
export function buildFeatureProviderIdsPatch(
  assignments: Partial<Record<FeatureKey, string[]>>,
): Partial<Config> {
  let patch: Record<string, unknown> = {}

  for (const key of FEATURE_KEYS) {
    const newIds = assignments[key]
    if (newIds === undefined) continue

    const def = FEATURE_PROVIDER_DEFS[key]

    const fragment: Record<string, unknown> = {}
    let current: Record<string, unknown> = fragment
    for (let i = 0; i < def.providerIdsConfigPath.length - 1; i++) {
      const next: Record<string, unknown> = {}
      current[def.providerIdsConfigPath[i]!] = next
      current = next
    }
    current[def.providerIdsConfigPath[def.providerIdsConfigPath.length - 1]!] = newIds

    patch = mergeWithArrayOverwrite(patch, fragment)
  }

  return patch
}

/**
 * Assign one provider as a feature's sole selection — used by inline
 * quick-switch pickers (selection toolbar footer) where picking a provider
 * means "use this one now". Writes both `providerId` and `providerIds` so
 * single- and multi-provider readers agree.
 */
export function buildFeatureProviderSelectionPatch(
  featureKey: FeatureKey,
  providerId: string,
): Partial<Config> {
  return mergeWithArrayOverwrite(
    buildFeatureProviderPatch({ [featureKey]: providerId }),
    buildFeatureProviderIdsPatch({ [featureKey]: [providerId] }),
  )
}
