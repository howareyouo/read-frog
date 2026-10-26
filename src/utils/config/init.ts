import { storage } from "#imports"
import type { Config } from "@/types/config/config"
import { configSchema } from "@/types/config/config"
import type { ConfigMeta } from "@/types/config/meta"
import { isAPIProviderConfig } from "@/types/config/provider"
import { initI18n } from "@/utils/i18n"
import {
  buildFreshDefaultConfig,
  CONFIG_SCHEMA_VERSION,
  CORRUPT_CONFIG_BACKUP_KEY,
  DEFAULT_CONFIG,
} from "../constants/config"
import { logger } from "../logger"
import { CONFIG_STORAGE_ITEM } from "./storage"

export interface InitializeConfigResult {
  /**
   * The config was created from defaults in this run — either no stored value existed, or the
   * stored value failed validation and was rebuilt. Callers use it to run one-time setup that
   * only makes sense on untouched defaults (see `selectFreshTranslateProviders`).
   */
  isFreshInstall: boolean
}

/**
 * Initialize the config, this function should only be called once in the background script
 * @returns The extension config
 */
export async function initializeConfig(): Promise<InitializeConfigResult> {
  const [storedConfig, configMeta] = await Promise.all([
    storage.getItem<Config>(CONFIG_STORAGE_ITEM),
    storage.getMeta<ConfigMeta>(CONFIG_STORAGE_ITEM),
  ])

  let config: Config
  let didConfigChange = false
  let isFreshInstall = false

  if (!storedConfig) {
    // Initialize locale before building defaults used by this browser context.
    await initI18n(DEFAULT_CONFIG.uiLanguage)
    config = buildFreshDefaultConfig()
    didConfigChange = true
    isFreshInstall = true
  } else {
    config = storedConfig
  }

  const parsedConfig = configSchema.safeParse(config)

  if (!parsedConfig.success) {
    logger.error("Config is invalid, using default config")
    // Keep the discarded config around — a corrupted store used to wipe the
    // user's settings silently; now it can be recovered from this key.
    if (storedConfig) {
      await storage.setItem(`local:${CORRUPT_CONFIG_BACKUP_KEY}`, {
        config: storedConfig,
        schemaVersion: configMeta?.schemaVersion ?? null,
        backedUpAt: Date.now(),
      })
    }
    await initI18n(DEFAULT_CONFIG.uiLanguage)
    config = buildFreshDefaultConfig()
    didConfigChange = true
    // The rebuilt config is untouched defaults, so recovered users get the
    // same one-time provider selection a genuine fresh install does.
    isFreshInstall = true
  } else {
    config = parsedConfig.data
    didConfigChange = parsedConfig.data !== storedConfig
  }

  if (import.meta.env.DEV) {
    const apiKeyResult = applyAPIKeysFromEnv(config)
    config = apiKeyResult.config
    didConfigChange = didConfigChange || apiKeyResult.changed

    const betaResult = applyDevBetaExperience(config)
    config = betaResult.config
    didConfigChange = didConfigChange || betaResult.changed
  }

  const didMetaNeedUpdate =
    configMeta?.schemaVersion !== CONFIG_SCHEMA_VERSION || configMeta?.lastModifiedAt === undefined

  if (didConfigChange) {
    await storage.setItem<Config>(CONFIG_STORAGE_ITEM, config)
  }

  if (didConfigChange || didMetaNeedUpdate) {
    await storage.setMeta<ConfigMeta>(CONFIG_STORAGE_ITEM, {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      lastModifiedAt: configMeta?.lastModifiedAt ?? Date.now(),
    })
  }

  return { isFreshInstall }
}

function applyAPIKeysFromEnv(config: Config): { config: Config; changed: boolean } {
  let changed = false

  const providersConfig = config.providersConfig.map((providerConfig) => {
    if (!isAPIProviderConfig(providerConfig)) {
      return providerConfig
    }

    const apiKeyEnvName = `WXT_${providerConfig.provider.toUpperCase()}_API_KEY`
    const envApiKey = import.meta.env[apiKeyEnvName] as string | undefined
    if (!envApiKey || providerConfig.apiKey === envApiKey) {
      return providerConfig
    }

    changed = true
    return {
      ...providerConfig,
      apiKey: envApiKey,
    }
  })

  if (!changed) {
    return { config, changed: false }
  }

  return {
    config: {
      ...config,
      providersConfig,
    },
    changed: true,
  }
}

function applyDevBetaExperience(config: Config): { config: Config; changed: boolean } {
  if (config.betaExperience.enabled) {
    return { config, changed: false }
  }

  return {
    config: {
      ...config,
      betaExperience: {
        ...config.betaExperience,
        enabled: true,
      },
    },
    changed: true,
  }
}
