import type { Config } from "@/types/config/config"
import { resolvePageTranslationProvider } from "@/utils/providers/provider-ref"

/**
 * DeepLX HTML-attribute capability state machine, moved verbatim from
 * translation-modes.ts. Caches per-provider verdicts (whether the provider
 * echoes HTML attribute placeholders back) and hands out exactly one probe
 * (a first in-flight request) per unknown provider.
 */

export const unsupportedDeepLXHtmlAttributeProviders = new Set<string>()
export const supportedDeepLXHtmlAttributeProviders = new Set<string>()
type DeepLXHtmlAttributeProbeResult = "supported" | "unsupported" | "unknown"
export interface DeepLXHtmlAttributeProbe {
  promise: Promise<DeepLXHtmlAttributeProbeResult>
  resolve: (result: DeepLXHtmlAttributeProbeResult) => void
}
const deepLXHtmlAttributeProbes = new Map<string, DeepLXHtmlAttributeProbe>()

function createDeepLXHtmlAttributeProbe(): DeepLXHtmlAttributeProbe {
  let resolve!: (result: DeepLXHtmlAttributeProbeResult) => void
  const promise = new Promise<DeepLXHtmlAttributeProbeResult>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

export function finishDeepLXHtmlAttributeProbe(
  providerKey: string,
  probe: DeepLXHtmlAttributeProbe | undefined,
  result: DeepLXHtmlAttributeProbeResult,
): void {
  if (!probe || deepLXHtmlAttributeProbes.get(providerKey) !== probe) return
  deepLXHtmlAttributeProbes.delete(providerKey)
  probe.resolve(result)
}

export async function acquireDeepLXHtmlAttributeProbe(providerKey: string): Promise<{
  probe?: DeepLXHtmlAttributeProbe
  useLegacy: boolean
}> {
  while (true) {
    if (unsupportedDeepLXHtmlAttributeProviders.has(providerKey)) {
      return { useLegacy: true }
    }
    if (supportedDeepLXHtmlAttributeProviders.has(providerKey)) {
      return { useLegacy: false }
    }

    const activeProbe = deepLXHtmlAttributeProbes.get(providerKey)
    if (!activeProbe) {
      const probe = createDeepLXHtmlAttributeProbe()
      deepLXHtmlAttributeProbes.set(providerKey, probe)
      return { probe, useLegacy: false }
    }

    // An empty/skipped request or a transient error proves neither support nor
    // incompatibility. Re-enter the loop so exactly one waiter owns the next probe.
    await activeProbe.promise
  }
}

export function getDeepLXHtmlAttributeProviderKey(config: Config): string | undefined {
  const providerConfig = resolvePageTranslationProvider(config)
  if (providerConfig.provider !== "deeplx") {
    return undefined
  }
  return `${providerConfig.id}:${providerConfig.baseURL ?? ""}`
}
