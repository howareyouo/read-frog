import type { Config } from "@/types/config/config"
import { getLocalConfig } from "@/utils/config/storage"
import {
  clearEffectiveSiteControlUrl,
  getEffectiveSiteControlUrl,
  isSiteEnabled,
} from "@/utils/site-control"

export interface ContentScriptGateResult {
  config: Config | null
  siteControlUrl: string
}

/**
 * Window flag set by the background right before programmatically injecting
 * the merged content script into an iframe: `true` for full-runtime frames
 * (selection UI included), `false` for translation-only frames. Manifest
 * injections (top frames) never set it — `undefined` means selection runs.
 */
export const SELECTION_ENABLED_WINDOW_KEY = "__READ_FROG_SELECTION_ENABLED__" as const

/**
 * Shared bootstrap gate for content-script entrypoints: the double-injection
 * guard (manifest-based + programmatic injection), the config read and the
 * site-control check.
 *
 * Returns `null` when the caller must bail out — either the script already
 * ran in this document, or the site is disabled. On a disabled site the guard
 * flag is cleared again and the injected site-control URL removed so a later
 * programmatic injection into the same document re-evaluates both.
 */
export async function passContentScriptGate(
  injectedWindowKey: string,
): Promise<ContentScriptGateResult | null> {
  const globalWindow = window as unknown as Record<string, unknown>

  // Prevent double injection (manifest-based + programmatic injection)
  if (globalWindow[injectedWindowKey]) return null
  globalWindow[injectedWindowKey] = true

  const config = await getLocalConfig()
  const siteControlUrl = getEffectiveSiteControlUrl(window.location.href)

  if (!isSiteEnabled(siteControlUrl, config)) {
    globalWindow[injectedWindowKey] = false
    clearEffectiveSiteControlUrl()
    return null
  }

  return { config, siteControlUrl }
}
