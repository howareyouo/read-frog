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
  getProviders: (config: Config) => string[]
  providersPath: readonly string[]
}

export const FEATURE_PROVIDER_DEFS = {
  pageTranslation: {
    getProviders: (c: Config) => c.pageTranslation.providers,
    providersPath: ["pageTranslation", "providers"],
  },
  videoSubtitles: {
    getProviders: (c: Config) => c.videoSubtitles.providers,
    providersPath: ["videoSubtitles", "providers"],
  },
  selectionTranslation: {
    getProviders: (c: Config) => c.selectionToolbar.features.translate.providers,
    providersPath: ["selectionToolbar", "features", "translate", "providers"],
  },
  inputTranslation: {
    getProviders: (c: Config) => c.inputTranslation.providers,
    providersPath: ["inputTranslation", "providers"],
  },
} as const satisfies Record<FeatureKey, FeatureProviderDef>

/**
 * The provider ids a feature will rotate through; the first one is the
 * feature's primary provider.
 */
export function getFeatureProviders(config: Config, featureKey: FeatureKey): string[] {
  return FEATURE_PROVIDER_DEFS[featureKey].getProviders(config)
}

/** The primary provider — first of `providers`. */
export function getPrimaryFeatureProvider(config: Config, featureKey: FeatureKey): string {
  return getFeatureProviders(config, featureKey)[0] ?? ""
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
    const providerId = getPrimaryFeatureProvider(config, featureKey)
    throw new Error(`No provider config for id "${providerId}" (feature "${featureKey}")`)
  }
  return providerConfig
}

export function resolveProviderConfigOrNull(
  config: Config,
  featureKey: FeatureKey,
): ProviderConfig | null {
  const providerId = getPrimaryFeatureProvider(config, featureKey)
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
 * FEATURE_PROVIDER_DEFS.providersPath.
 */
export function buildFeatureProvidersPatch(
  assignments: Partial<Record<FeatureKey, string[]>>,
): Partial<Config> {
  let patch: Record<string, unknown> = {}

  for (const key of FEATURE_KEYS) {
    const newIds = assignments[key]
    if (newIds === undefined) continue

    patch = setConfigPath(patch, FEATURE_PROVIDER_DEFS[key].providersPath, newIds)
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
  provider: string,
): Partial<Config> {
  return buildFeatureProvidersPatch({ [featureKey]: [provider] })
}
