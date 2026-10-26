import { initializeConfig } from "@/utils/config/init"
import { getCachedConfig } from "@/utils/config/storage"
import { memoizePromise } from "@/utils/utils"

// To avoid the background script initializing config simultaneously and hitting
// a race condition, initialize at most once.
const initializeConfigOnce = memoizePromise(initializeConfig)

/**
 * Config after initialization, via the same validated read every other context
 * uses (`getCachedConfig`): missing → null, schema-invalid → DEFAULT_CONFIG.
 * Background consumers must not bypass validation — a raw read would hand
 * business logic a value that only claims to be a `Config`.
 */
export async function ensureInitializedConfig() {
  await initializeConfigOnce()
  return getCachedConfig()
}

/**
 * Whether the config was created from defaults in this run, rather than loaded from storage.
 * Shares the memoized initialization above, so it never triggers a second init.
 */
export async function isFreshInstalledConfig() {
  return (await initializeConfigOnce()).isFreshInstall
}
