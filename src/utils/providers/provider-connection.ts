import type { ProviderConfig } from "@/types/config/provider"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { sendMessage } from "@/utils/message"

/**
 * One-shot connectivity probe: a tiny direct translate against the given
 * provider config. Pin `model`/`apiKey` on the config to test a specific
 * credential — the direct translate handler runs pinned configs as-is.
 */
export function probeProviderConnection(providerConfig: ProviderConfig) {
  return sendMessage("directTranslate", {
    text: "Hi",
    langConfig: DEFAULT_CONFIG.language,
    providerConfig,
  })
}
