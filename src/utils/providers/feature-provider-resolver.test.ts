import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Config } from "@/types/config/config"
import {
  clearProviderCooldown,
  markProviderCoolingDown,
} from "@/utils/providers/provider-cooldown"
import {
  getFeatureProviderSetCacheIdentity,
  getUsableLLMFeatureProviderIds,
  hasUsableLLMFeatureProvider,
  isPrimaryFeatureProviderLLM,
  resolveRotatingProviderRefForFeature,
} from "./feature-provider-resolver"

// The helpers only read `videoSubtitles.providerIds`, `providersConfig[].id`,
// `.enabled` and `.provider` — a structural fixture cast to Config keeps the
// test focused on selection logic instead of the full config schema. Extra
// keys (e.g. apiKey) are allowed so cache-identity tests can simulate edits.
function makeConfig(
  providerIds: string[],
  providers: Array<{ id: string; enabled: boolean; provider: string } & Record<string, unknown>>,
): Config {
  return {
    videoSubtitles: { providerIds, providerId: providerIds[0] },
    providersConfig: providers,
  } as unknown as Config
}

const llm = (id: string, enabled = true) => ({ id, enabled, provider: "openai-compatible" })
const pure = (id: string, enabled = true) => ({ id, enabled, provider: "microsoft-translate" })

// The cooldown registry is module-global, exactly as it is in the background.
beforeEach(() => clearProviderCooldown())
afterEach(() => clearProviderCooldown())

describe("hasUsableLLMFeatureProvider", () => {
  it("is true only when an enabled LLM provider serves the feature", () => {
    expect(hasUsableLLMFeatureProvider(makeConfig(["llm"], [llm("llm")]), "videoSubtitles")).toBe(
      true,
    )
    expect(
      hasUsableLLMFeatureProvider(makeConfig(["pure"], [pure("pure")]), "videoSubtitles"),
    ).toBe(false)
    expect(
      hasUsableLLMFeatureProvider(
        makeConfig(["llm", "pure"], [llm("llm", false), pure("pure")]),
        "videoSubtitles",
      ),
    ).toBe(false)
  })
})

describe("smart context coverage", () => {
  // The status list used to demand that *every* selected provider be an LLM, so a rotation of
  // "Microsoft Translate + an LLM" read as "no LLM provider selected". It now asks the two
  // questions that actually decide whether a summary gets built: is any provider promptable,
  // and is the first one (the summary's author) promptable.
  it("counts the promptable providers without requiring all of them", () => {
    const config = makeConfig(["pure", "llm", "off"], [pure("pure"), llm("llm"), llm("off", false)])
    expect(getUsableLLMFeatureProviderIds(config, "videoSubtitles")).toEqual(["llm"])
    expect(hasUsableLLMFeatureProvider(config, "videoSubtitles")).toBe(true)
  })

  it("reports the first provider as unusable for summaries when a pure translator leads", () => {
    const mixed = makeConfig(["pure", "llm"], [pure("pure"), llm("llm")])
    expect(isPrimaryFeatureProviderLLM(mixed, "videoSubtitles")).toBe(false)

    const llmFirst = makeConfig(["llm", "pure"], [llm("llm"), pure("pure")])
    expect(isPrimaryFeatureProviderLLM(llmFirst, "videoSubtitles")).toBe(true)
  })

  it("reports no coverage at all when every selected provider is a pure translator", () => {
    const config = makeConfig(["pure"], [pure("pure")])
    expect(hasUsableLLMFeatureProvider(config, "videoSubtitles")).toBe(false)
    expect(isPrimaryFeatureProviderLLM(config, "videoSubtitles")).toBe(false)
  })
})

describe("getFeatureProviderSetCacheIdentity", () => {
  it("is rotation-stable: identical across repeated reads while per-request rotation cycles", () => {
    const config = makeConfig(["a", "b"], [llm("a"), llm("b")])
    const identity = getFeatureProviderSetCacheIdentity(config, "videoSubtitles")
    // Reading it must not advance the round-robin, and repeated reads must
    // agree — this is what keeps request hashes identical across toggle/remount
    // re-runs where the rotation lands on different providers.
    expect(identity).toBe(getFeatureProviderSetCacheIdentity(config, "videoSubtitles"))
    expect(resolveRotatingProviderRefForFeature("videoSubtitles", config)).not.toBeNull()
    expect(resolveRotatingProviderRefForFeature("videoSubtitles", config)).not.toBeNull()
    expect(getFeatureProviderSetCacheIdentity(config, "videoSubtitles")).toBe(identity)
  })

  it("serializes the ordered usable set, so edits/adds/removals/disables invalidate", () => {
    const base = makeConfig(["a", "b"], [llm("a"), llm("b")])
    const identity = getFeatureProviderSetCacheIdentity(base, "videoSubtitles")
    expect(identity).not.toBeNull()
    expect(JSON.parse(identity as string)).toEqual([llm("a"), llm("b")])

    // A provider config edit (new key/model) invalidates.
    expect(
      getFeatureProviderSetCacheIdentity(
        makeConfig(["a", "b"], [llm("a"), { ...llm("b"), apiKey: "new" }]),
        "videoSubtitles",
      ),
    ).not.toBe(identity)
    // Selection change invalidates.
    expect(
      getFeatureProviderSetCacheIdentity(makeConfig(["a"], [llm("a"), llm("b")]), "videoSubtitles"),
    ).not.toBe(identity)
    // Disabling a member invalidates.
    expect(
      getFeatureProviderSetCacheIdentity(
        makeConfig(["a", "b"], [llm("a"), llm("b", false)]),
        "videoSubtitles",
      ),
    ).not.toBe(identity)
  })

  it("is null when no provider can serve the feature", () => {
    expect(
      getFeatureProviderSetCacheIdentity(makeConfig(["a"], [llm("a", false)]), "videoSubtitles"),
    ).toBeNull()
  })
})

describe("resolveRotatingProviderRefForFeature", () => {
  it("returns null when no LLM provider qualifies under requireLLM", () => {
    const config = makeConfig(["pure"], [pure("pure")])
    expect(resolveRotatingProviderRefForFeature("videoSubtitles", config)).toBeNull()
    expect(
      resolveRotatingProviderRefForFeature("videoSubtitles", config, { requireLLM: false }),
    ).not.toBeNull()
  })

  it("rotates only among enabled LLM providers and skips disabled ones", () => {
    // The round-robin counter is module-global, so the absolute sequence
    // depends on earlier tests — assert the reachable set, not the order.
    const config = makeConfig(["a", "b", "c"], [llm("a"), llm("b", false), llm("c")])
    const seen = new Set<string>()
    for (let i = 0; i < 4; i++) {
      const ref = resolveRotatingProviderRefForFeature("videoSubtitles", config)
      seen.add(ref!.config.id)
    }
    expect(seen).toEqual(new Set(["a", "c"]))
  })

  it("routes around a provider that is cooling down", () => {
    // The point of selecting several providers: one 429 must not stall the video
    // while another key sits idle beside it.
    markProviderCoolingDown("a", "rate-limit")
    const config = makeConfig(["a", "b"], [llm("a"), llm("b")])
    const seen = new Set<string>()
    for (let i = 0; i < 4; i++) {
      seen.add(resolveRotatingProviderRefForFeature("videoSubtitles", config)!.config.id)
    }
    expect(seen).toEqual(new Set(["b"]))
  })

  it("returns null instead of a guaranteed refusal when the whole list is cooling", () => {
    markProviderCoolingDown("a", "rate-limit")
    markProviderCoolingDown("b", "rate-limit")
    const config = makeConfig(["a", "b"], [llm("a"), llm("b")])
    expect(resolveRotatingProviderRefForFeature("videoSubtitles", config)).toBeNull()
  })

  it("excludes the providers one request has already burned", () => {
    const config = makeConfig(["a", "b"], [llm("a"), llm("b")])
    expect(
      resolveRotatingProviderRefForFeature("videoSubtitles", config, {
        excludeIds: new Set(["a", "b"]),
      }),
    ).toBeNull()
    expect(
      resolveRotatingProviderRefForFeature("videoSubtitles", config, {
        excludeIds: new Set(["a"]),
      })!.config.id,
    ).toBe("b")
  })
})
