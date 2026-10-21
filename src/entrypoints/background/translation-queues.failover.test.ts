import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Config } from "@/types/config/config"
import {
  clearProviderCooldown,
  getProviderCooldownRemainingMs,
  isProviderCoolingDown,
  markProviderCoolingDown,
} from "@/utils/providers/provider-cooldown"
import { attachRequestErrorMeta, getRequestErrorMeta } from "@/utils/request/retry-policy"
import type { QueuedTranslationProvider } from "./translation-queues"
import { executeWithProviderFailover } from "./translation-queues"

// Same structural fixture as the resolver tests: the failover path only reads
// the feature's provider ids and each provider's id/enabled/capability.
function makeConfig(ids: string[]): Config {
  return {
    videoSubtitles: { providers: ids },
    providersConfig: ids.map((id) => ({
      id,
      enabled: true,
      provider: "openai-compatible",
    })),
  } as unknown as Config
}

const seedFor = (id: string) =>
  ({
    kind: "local",
    config: { id, enabled: true, provider: "openai-compatible" },
  }) as unknown as QueuedTranslationProvider

const providerIdOf = (provider: QueuedTranslationProvider) =>
  "kind" in provider ? provider.config.id : provider.id

const rateLimit = (retryAfterMs?: number) =>
  attachRequestErrorMeta(new Error("429 Too Many Requests"), { statusCode: 429, retryAfterMs })

const accessDenied = () =>
  attachRequestErrorMeta(new Error("403 permission denied"), { statusCode: 403 })

const timeout = () => new Error("Task timed out after 20000ms")

beforeEach(() => clearProviderCooldown())
afterEach(() => clearProviderCooldown())

describe("executeWithProviderFailover", () => {
  it("asks the next provider after one rate limits, instead of retrying the same one", async () => {
    // The bug this guards: a 429 paused the queue and re-sent the batch to the
    // SAME provider until its give-up budget ran out, so a second selected key
    // never got a turn and the video stalled on the first one's cooldown.
    const seen: string[] = []
    const result = await executeWithProviderFailover({
      config: makeConfig(["a", "b"]),
      requireLLM: true,
      seed: seedFor("a"),
      run: async (provider) => {
        const id = providerIdOf(provider)
        seen.push(id)
        if (id === "a") throw rateLimit()
        return `from ${id}`
      },
    })

    expect(seen).toEqual(["a", "b"])
    expect(result).toBe("from b")
    expect(isProviderCoolingDown("a")).toBe(true)
    expect(isProviderCoolingDown("b")).toBe(false)
  })

  it("parks a rejected key too, so a bad model cannot eat every retry", async () => {
    const seen: string[] = []
    await expect(
      executeWithProviderFailover({
        config: makeConfig(["a", "b"]),
        requireLLM: true,
        seed: seedFor("a"),
        run: async (provider) => {
          seen.push(providerIdOf(provider))
          throw accessDenied()
        },
      }),
    ).rejects.toThrow(/403/)

    expect(seen).toEqual(["a", "b"])
    expect(isProviderCoolingDown("a")).toBe(true)
    expect(isProviderCoolingDown("b")).toBe(true)
  })

  it("does not re-send a timeout or a bad batch response to another provider", async () => {
    // Those say nothing about the credential; a second provider would only
    // double the cost of the same failure.
    const seen: string[] = []
    await expect(
      executeWithProviderFailover({
        config: makeConfig(["a", "b"]),
        requireLLM: true,
        seed: seedFor("a"),
        run: async (provider) => {
          seen.push(providerIdOf(provider))
          throw timeout()
        },
      }),
    ).rejects.toThrow(/timed out/)

    expect(seen).toEqual(["a"])
    expect(isProviderCoolingDown("a")).toBe(false)
  })

  it("widens the final error to the first recovery in the fleet", async () => {
    // The queue pauses on this error's Retry-After. The last provider to answer
    // is a poor witness for the whole list: if another one is free in 5s, the
    // queue should be back to work in 5s.
    vi.useFakeTimers()
    try {
      markProviderCoolingDown("b", "rate-limit", 2_000)

      const error = await executeWithProviderFailover({
        config: makeConfig(["a", "b"]),
        requireLLM: true,
        seed: seedFor("a"),
        run: async () => {
          throw rateLimit(60_000)
        },
      }).catch((reason: unknown) => reason)

      expect(getRequestErrorMeta(error).kind).toBe("rate-limit")
      // b's 5s window, not a's 60s one.
      expect(getRequestErrorMeta(error).retryAfterMs).toBe(5_000)
      expect(isProviderCoolingDown("a")).toBe(true)
      expect(isProviderCoolingDown("b")).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("hands back a rate-limit error when nothing is selectable because all are cooling", async () => {
    // Distinct from "no provider configured": the queue must WAIT for this one,
    // not drain the backlog the way a 401 would.
    vi.useFakeTimers()
    try {
      markProviderCoolingDown("a", "rate-limit", 30_000)
      markProviderCoolingDown("b", "rate-limit", 12_000)

      const error = await executeWithProviderFailover({
        config: makeConfig(["a", "b"]),
        requireLLM: true,
        run: async () => "unreachable",
      }).catch((reason: unknown) => reason)

      expect(error).toBeInstanceOf(Error)
      expect(getRequestErrorMeta(error).kind).toBe("rate-limit")
      // The soonest recovery, not the longest: b is back first.
      expect(getRequestErrorMeta(error).retryAfterMs).toBe(12_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it("clears a provider's accumulated backoff once one of its requests succeeds", async () => {
    vi.useFakeTimers()
    try {
      markProviderCoolingDown("a", "rate-limit")
      markProviderCoolingDown("a", "rate-limit") // 10s: the counter is climbing
      vi.advanceTimersByTime(10_000)
      expect(isProviderCoolingDown("a")).toBe(false)

      await executeWithProviderFailover({
        config: makeConfig(["a", "b"]),
        requireLLM: true,
        seed: seedFor("a"),
        run: async () => "from a",
      })

      // A provider that just served a request starts from the first window
      // again; a transient hiccup from months ago must not cost 80s today.
      markProviderCoolingDown("a", "rate-limit")
      expect(getProviderCooldownRemainingMs("a")).toBe(5_000)
    } finally {
      vi.useRealTimers()
    }
  })
})
