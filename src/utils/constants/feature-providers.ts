import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import { getProviderConfigById } from "../config/helpers"

export const FEATURE_KEYS = [
  "pageTranslation",
  "videoSubtitles",
  "selectionTranslation",
  "inputTranslation",
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

export interface FeatureProviderDef {
  /** The providers a feature rotates through; the first one is the primary. */
  getProviderIds: (config: Config) => string[]
  providerIdsConfigPath: readonly string[]
}

export const FEATURE_PROVIDER_DEFS = {
  pageTranslation: {
    getProviderIds: (c: Config) => c.pageTranslation.providerIds,
    providerIdsConfigPath: ["pageTranslation", "providerIds"],
  },
  videoSubtitles: {
    getProviderIds: (c: Config) => c.videoSubtitles.providerIds,
    providerIdsConfigPath: ["videoSubtitles", "providerIds"],
  },
  selectionTranslation: {
    getProviderIds: (c: Config) => c.selectionToolbar.features.translate.providerIds,
    providerIdsConfigPath: ["selectionToolbar", "features", "translate", "providerIds"],
  },
  inputTranslation: {
    getProviderIds: (c: Config) => c.inputTranslation.providerIds,
    providerIdsConfigPath: ["inputTranslation", "providerIds"],
  },
} as const satisfies Record<FeatureKey, FeatureProviderDef>

/**
 * The provider ids a feature will rotate through; the first one is the
 * feature's primary provider.
 */
export function getFeatureProviderIds(config: Config, featureKey: FeatureKey): string[] {
  return FEATURE_PROVIDER_DEFS[featureKey].getProviderIds(config)
}

/** The primary provider — first of `providerIds`. */
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
 * Immutably assign `value` at a nested `path`, creating intermediate objects
 * as needed. Feature config paths never overlap, so successive assignments
 * into one patch object never clobber each other.
 */
export function setConfigPath(
  config: Record<string, unknown> | undefined,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path
  if (head === undefined) return value as Record<string, unknown>
  const child = config?.[head] as Record<string, unknown> | undefined
  return {
    ...config,
    [head]: setConfigPath(child, rest, value),
  }
}

/**
 * Convert a feature→provider-ids mapping into a Partial<Config> using
 * FEATURE_PROVIDER_DEFS.providerIdsConfigPath.
 */
export function buildFeatureProviderIdsPatch(
  assignments: Partial<Record<FeatureKey, string[]>>,
): Partial<Config> {
  let patch: Record<string, unknown> = {}

  for (const key of FEATURE_KEYS) {
    const newIds = assignments[key]
    if (newIds === undefined) continue

    patch = setConfigPath(patch, FEATURE_PROVIDER_DEFS[key].providerIdsConfigPath, newIds)
  }

  return patch
}

/**
 * Assign one provider as a feature's sole selection — used by inline
 * quick-switch pickers (selection toolbar footer) where picking a provider
 * means "use this one now".
 */
export function buildFeatureProviderSelectionPatch(
  featureKey: FeatureKey,
  providerId: string,
): Partial<Config> {
  return buildFeatureProviderIdsPatch({ [featureKey]: [providerId] })
}
