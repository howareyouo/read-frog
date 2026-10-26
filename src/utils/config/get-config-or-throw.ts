import type { Config } from "@/types/config/config"
import { getCachedConfig } from "./storage"

/**
 * {@link getCachedConfig} variant that throws instead of returning `null`.
 *
 * Deliberately lives in its own module: a helper defined inside `storage.ts`
 * would bind to the module-internal `getCachedConfig` and bypass `vi.mock`,
 * while this cross-module import goes through the mocked surface. Tests rely
 * on `getCachedConfig` being the single mock seam for config.
 */
export async function getConfigOrThrow(): Promise<Config> {
  const config = await getCachedConfig()
  if (!config) {
    throw new Error("No global config when translate text")
  }
  return config
}
