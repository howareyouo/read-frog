/**
 * Providers that just refused a request, and for how long to leave them alone.
 *
 * A 429 says something about ONE credential — the key, its tier, its per-minute
 * budget — and nothing about the next provider the user selected. Without this
 * record a rate-limited provider kept being retried (paused, retried, paused…)
 * while the healthy ones beside it sat idle, so the whole video waited on the
 * one key that ran out. The rotation consults it before picking a provider, so
 * the next attempt lands somewhere else.
 *
 * In-memory on purpose: a cooldown that survived a service-worker restart would
 * outlive whatever quota window it described.
 */

import { exponentialBackoffMs } from "@/utils/request/retry-policy"

export type ProviderFailureKind = "rate-limit" | "access-denied"

// No Retry-After header: assume the shortest plausible quota window and let the
// next attempt find out. Doubles per consecutive failure on the same provider.
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 5_000
// A rejected key/model/endpoint will not fix itself mid-video; park it for long
// enough that a whole playback never re-pays the round trip, short enough that a
// key the user just edited is back on the next request.
const ACCESS_DENIED_COOLDOWN_MS = 60_000
// A provider advertising a 20-minute Retry-After is not worth believing
// verbatim: the queue would stall for it. Cap it and let the rotation move on.
const MAX_COOLDOWN_MS = 5 * 60_000

/** provider id → ms epoch until which it must be skipped. */
const cooldownUntilById = new Map<string, number>()
/** provider id → failures in a row, so repeated 429s back off instead of piling up. */
const consecutiveFailuresById = new Map<string, number>()

/**
 * Record that `providerId` cannot serve requests right now.
 *
 * `retryAfterMs` is the provider's own answer (Retry-After) and wins when it is
 * longer than our guess; a shorter one is ignored, because the provider that
 * just 429'd is the worst available witness to its own recovery.
 */
export function markProviderCoolingDown(
  providerId: string,
  kind: ProviderFailureKind,
  retryAfterMs?: number,
): void {
  const now = Date.now()
  const failures = (consecutiveFailuresById.get(providerId) ?? 0) + 1
  consecutiveFailuresById.set(providerId, failures)

  const base =
    kind === "access-denied"
      ? ACCESS_DENIED_COOLDOWN_MS
      : exponentialBackoffMs(DEFAULT_RATE_LIMIT_COOLDOWN_MS, Math.min(failures - 1, 4))
  const cooldownMs = Math.min(Math.max(base, retryAfterMs ?? 0), MAX_COOLDOWN_MS)

  cooldownUntilById.set(providerId, now + cooldownMs)
}

/** Whether a successful request reset the backoff for this provider. */
export function clearProviderCooldown(providerId?: string): void {
  if (providerId === undefined) {
    cooldownUntilById.clear()
    consecutiveFailuresById.clear()
    return
  }
  cooldownUntilById.delete(providerId)
  consecutiveFailuresById.delete(providerId)
}

export function isProviderCoolingDown(providerId: string, now = Date.now()): boolean {
  return getProviderCooldownRemainingMs(providerId, now) > 0
}

export function getProviderCooldownRemainingMs(providerId: string, now = Date.now()): number {
  const until = cooldownUntilById.get(providerId)
  if (until === undefined) return 0
  if (until > now) return until - now
  // Self-expiring: keeps the map bounded without a sweeper. The failure count
  // survives, so a provider that 429s again after a short recovery keeps
  // backing off instead of restarting from the first window — only a request
  // that actually came back (`clearProviderCooldown`) resets it.
  cooldownUntilById.delete(providerId)
  return 0
}

/** The subset of `providerIds` that may be dispatched to right now. */
export function filterCoolingDownProviders(providerIds: string[], now = Date.now()): string[] {
  return providerIds.filter((id) => !isProviderCoolingDown(id, now))
}

/**
 * ms until at least one of `providerIds` is usable again — 0 when one already
 * is. Used to tell the queue how long a pause must last for the fleet to
 * recover, instead of guessing from whichever provider answered last.
 */
export function soonestCooldownRecoveryMs(providerIds: string[], now = Date.now()): number {
  let soonest = Infinity
  for (const id of providerIds) {
    const remaining = getProviderCooldownRemainingMs(id, now)
    if (remaining === 0) return 0
    soonest = Math.min(soonest, remaining)
  }
  return Number.isFinite(soonest) ? soonest : 0
}
