import { storage } from "#imports"
import type { Config } from "@/types/config/config"
import { configSchema } from "@/types/config/config"
import type { ConfigMeta, ConfigValueAndMeta } from "@/types/config/meta"
import { CONFIG_SCHEMA_VERSION, CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "../constants/config"
import { logger } from "../logger"
import { memoizePromise } from "../utils"

export const CONFIG_STORAGE_ITEM = `local:${CONFIG_STORAGE_KEY}`

async function writeConfigItem(config: Config, meta: Partial<ConfigMeta>) {
  const parsedConfig = configSchema.safeParse(config)
  if (!parsedConfig.success) {
    throw new Error("Config is invalid")
  }
  await storage.setItem<Config>(CONFIG_STORAGE_ITEM, parsedConfig.data)
  await storage.setMeta<Partial<ConfigMeta>>(CONFIG_STORAGE_ITEM, meta)
}

export async function getLocalConfig() {
  const config = await storage.getItem<Config>(CONFIG_STORAGE_ITEM)
  if (!config) {
    logger.warn("No config found in storage")
    return null
  }
  const parsedConfig = configSchema.safeParse(config)
  if (!parsedConfig.success) {
    logger.error("Config is invalid, using default config")
    return DEFAULT_CONFIG
  }
  return parsedConfig.data
}

const memoizedGetLocalConfig = memoizePromise(getLocalConfig)
let configCacheWatcherRegistered = false

function ensureConfigCacheWatcher() {
  if (configCacheWatcherRegistered) return
  configCacheWatcherRegistered = true
  storage.watch<Config>(CONFIG_STORAGE_ITEM, () => {
    memoizedGetLocalConfig.reset()
  })
}

/**
 * Cached variant of {@link getLocalConfig}. Resolves the config (storage read +
 * full schema validation, including the config-wide `superRefine`) at most once
 * per storage revision; subsequent calls within the same config version return
 * the memoized promise.
 *
 * Hot paths call this repeatedly — every MutationObserver batch
 * (`page-translation.ts`) and every translated paragraph (`translate-variants.ts`
 * / `translate-input.ts`) — so re-parsing the whole schema per call is a major
 * per-frame cost on live/SPA pages. The cache is invalidated automatically when
 * the config changes in storage, so callers can treat the returned object as
 * always reflecting the current config.
 */
export async function getCachedConfig(): Promise<Config | null> {
  ensureConfigCacheWatcher()
  return memoizedGetLocalConfig()
}

export async function setLocalConfig(config: Config) {
  await writeConfigItem(config, { lastModifiedAt: Date.now() })
}

export async function getLocalConfigAndMeta(): Promise<ConfigValueAndMeta> {
  try {
    const [config, meta] = await Promise.all([
      storage.getItem<Config>(CONFIG_STORAGE_ITEM),
      storage.getMeta<ConfigMeta>(CONFIG_STORAGE_ITEM),
    ])

    if (!config) {
      throw new Error("Local config not found")
    }

    const parsedConfig = configSchema.safeParse(config)
    if (!parsedConfig.success) {
      throw new Error("Local config is invalid")
    }

    return {
      value: parsedConfig.data,
      meta: {
        schemaVersion: meta?.schemaVersion ?? CONFIG_SCHEMA_VERSION,
        lastModifiedAt: meta?.lastModifiedAt ?? Date.now(),
      },
    }
  } catch (error) {
    logger.error("Failed to get local config", error)
    throw error
  }
}

export async function setLocalConfigAndMeta(config: Config, meta: Partial<ConfigMeta>) {
  await writeConfigItem(config, {
    ...meta,
    lastModifiedAt: meta.lastModifiedAt ?? Date.now(),
  })
}
