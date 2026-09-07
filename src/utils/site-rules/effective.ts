import type { Config } from "@/types/config/config"
import { BUILT_IN_SITE_RULES } from "./built-in"
import type { ResolvedSiteRule } from "./resolve"
import { resolveSiteRule } from "./resolve"

const cache = new WeakMap<Config, Map<string, ResolvedSiteRule>>()

/**
 * Resolve the effective site rule for `url` under `config`, memoized per
 * (config, url). Within one walk/translation batch the same config object is
 * threaded everywhere, so hot-path callers (per-element filters) get an O(1)
 * lookup; a fresh config fetch or an SPA navigation (new URL) misses the cache
 * and re-resolves naturally.
 */
export function getEffectiveSiteRule(config: Config, url: string): ResolvedSiteRule {
  let perUrl = cache.get(config)
  if (!perUrl) {
    perUrl = new Map()
    cache.set(config, perUrl)
  }

  const cached = perUrl.get(url)
  if (cached) {
    return cached
  }

  // Defensive against configs written before the siteRules field existed
  // (upgrade window) and partial test fixtures.
  const rule = resolveSiteRule(
    url,
    BUILT_IN_SITE_RULES,
    config.siteRules?.userRules ?? [],
    config.siteRules?.disabledBuiltInRules ?? [],
  )
  perUrl.set(url, rule)
  return rule
}
