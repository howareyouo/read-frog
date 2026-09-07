import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearProviderCooldown,
  filterCoolingDownProviders,
  getProviderCooldownRemainingMs,
  isProviderCoolingDown,
  markProviderCoolingDown,
  soonestCooldownRecoveryMs,
} from "./provider-cooldown"

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  clearProviderCooldown()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("markProviderCoolingDown", () => {
  it("parks a provider for the first rate-limit window", () => {
    markProviderCoolingDown("a", "rate-limit")
    expect(isProviderCoolingDown("a")).toBe(true)
    expect(isProviderCoolingDown("b")).toBe(false)

    vi.advanceTimersByTime(4_999)
    expect(isProviderCoolingDown("a")).toBe(true)

    vi.advanceTimersByTime(1)
    expect(isProviderCoolingDown("a")).toBe(false)
  })

  it("trusts a longer Retry-After and ignores a shorter one", () => {
    markProviderCoolingDown("a", "rate-limit", 30_000)
    expect(getProviderCooldownRemainingMs("a")).toBe(30_000)

    markProviderCoolingDown("b", "rate-limit", 500)
    // The provider that just refused is the worst witness to its own recovery:
    // a 500ms Retry-After would have us knock again almost immediately.
    expect(getProviderCooldownRemainingMs("b")).toBe(5_000)
  })

  it("backs off a provider that keeps refusing, and resets on a success", () => {
    for (const expected of [5_000, 10_000, 20_000, 40_000, 80_000]) {
      markProviderCoolingDown("a", "rate-limit")
      expect(getProviderCooldownRemainingMs("a")).toBe(expected)
      vi.advanceTimersByTime(expected)
    }

    clearProviderCooldown("a")
    markProviderCoolingDown("a", "rate-limit")
    expect(getProviderCooldownRemainingMs("a")).toBe(5_000)
  })

  it("caps an absurd Retry-After so the fleet is not held hostage by one provider", () => {
    markProviderCoolingDown("a", "rate-limit", 60 * 60_000)
    expect(getProviderCooldownRemainingMs("a")).toBe(5 * 60_000)
  })

  it("parks a hard denial longer than a transient rate limit", () => {
    markProviderCoolingDown("a", "access-denied")
    expect(getProviderCooldownRemainingMs("a")).toBe(60_000)
  })
})

describe("fleet helpers", () => {
  it("filters to the providers that may be dispatched to", () => {
    markProviderCoolingDown("a", "rate-limit")
    expect(filterCoolingDownProviders(["a", "b", "c"])).toEqual(["b", "c"])
  })

  it("reports no wait while any provider is usable", () => {
    markProviderCoolingDown("a", "rate-limit", 30_000)
    expect(soonestCooldownRecoveryMs(["a", "b"])).toBe(0)
  })

  it("reports the first recovery once the whole fleet is cooling", () => {
    markProviderCoolingDown("a", "rate-limit", 30_000)
    markProviderCoolingDown("b", "rate-limit", 12_000)
    expect(soonestCooldownRecoveryMs(["a", "b"])).toBe(12_000)
    expect(soonestCooldownRecoveryMs([])).toBe(0)
  })
})
