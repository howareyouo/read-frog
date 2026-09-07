import { storage } from "#imports"
import type { Config } from "@/types/config/config"
import { configSchema } from "@/types/config/config"
import type { LastSyncedConfigMeta, LastSyncedConfigValueAndMeta } from "@/types/config/meta"
import { LAST_SYNCED_CONFIG_STORAGE_KEY } from "../constants/config"
import { logger } from "../logger"

export async function getLastSyncedConfigAndMeta(): Promise<LastSyncedConfigValueAndMeta | null> {
  const [rawValue, meta] = await Promise.all([
    storage.getItem<unknown>(`local:${LAST_SYNCED_CONFIG_STORAGE_KEY}`),
    storage.getMeta<LastSyncedConfigMeta>(`local:${LAST_SYNCED_CONFIG_STORAGE_KEY}`),
  ])

  if (!rawValue || !meta) {
    return null
  }

  const parseResult = configSchema.safeParse(rawValue)
  if (!parseResult.success) {
    logger.error("Failed to validate last synced config", parseResult.error)
    return null
  }
  return { value: parseResult.data, meta }
}

export async function setLastSyncConfigAndMeta(
  value: Config,
  meta: Partial<LastSyncedConfigMeta>,
): Promise<void> {
  const lastSyncedAt = meta.lastSyncedAt ?? Date.now()

  await Promise.all([
    storage.setItem<Config>(`local:${LAST_SYNCED_CONFIG_STORAGE_KEY}`, value),
    storage.setMeta<Partial<LastSyncedConfigMeta>>(`local:${LAST_SYNCED_CONFIG_STORAGE_KEY}`, {
      ...meta,
      lastSyncedAt,
    }),
  ])
}
