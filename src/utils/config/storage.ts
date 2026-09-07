import { storage } from "#imports"
import type { Config } from "@/types/config/config"
import { configSchema } from "@/types/config/config"
import type { ConfigMeta, ConfigValueAndMeta } from "@/types/config/meta"
import { CONFIG_SCHEMA_VERSION, CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from "../constants/config"
import { logger } from "../logger"

export async function getLocalConfig() {
  const config = await storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`)
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

let cachedConfigPromise: Promise<Config | null> | undefined
let configCacheWatcherRegistered = false

function ensureConfigCacheWatcher() {
  if (configCacheWatcherRegistered) return
  configCacheWatcherRegistered = true
  storage.watch<Config>(`local:${CONFIG_STORAGE_KEY}`, () => {
    cachedConfigPromise = undefined
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
export function getCachedConfig(): Promise<Config | null> {
  ensureConfigCacheWatcher()
  if (cachedConfigPromise === undefined) {
    cachedConfigPromise = getLocalConfig()
  }
  return cachedConfigPromise
}

export async function setLocalConfig(config: Config) {
  const parsedConfig = configSchema.safeParse(config)
  if (!parsedConfig.success) {
    throw new Error("Config is invalid")
  }
  await storage.setItem<Config>(`local:${CONFIG_STORAGE_KEY}`, parsedConfig.data)
  await storage.setMeta<Partial<ConfigMeta>>(`local:${CONFIG_STORAGE_KEY}`, {
    lastModifiedAt: Date.now(),
  })
}

export async function getLocalConfigAndMeta(): Promise<ConfigValueAndMeta> {
  try {
    const [config, meta] = await Promise.all([
      storage.getItem<Config>(`local:${CONFIG_STORAGE_KEY}`),
      storage.getMeta<ConfigMeta>(`local:${CONFIG_STORAGE_KEY}`),
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
  const lastModifiedAt = meta.lastModifiedAt ?? Date.now()
  const parsedConfig = configSchema.safeParse(config)
  if (!parsedConfig.success) {
    throw new Error("Config is invalid")
  }
  await storage.setItem<Config>(`local:${CONFIG_STORAGE_KEY}`, parsedConfig.data)
  await storage.setMeta<Partial<ConfigMeta>>(`local:${CONFIG_STORAGE_KEY}`, {
    ...meta,
    lastModifiedAt,
  })
}
