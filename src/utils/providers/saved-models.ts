import type { LLMProviderConfig } from "@/types/config/provider"
import { resolveModelId } from "./model-id"

export interface SavedModelsSync {
  model: NonNullable<LLMProviderConfig["model"]>
  /** How many saved models dropped out of the freshly fetched list. */
  prunedCount: number
  /** Whether the primary model was re-pinned to the first selected model. */
  primaryReplaced: boolean
}

/**
 * Reconciles the provider's saved models with a freshly fetched model list.
 *
 * `rotationModels` only ever grows through user checks (and "test & select"
 * auto-checking passing models), so entries the provider stops serving linger
 * as ghosts: invisible in the fetched list yet still requested by credential
 * rotation. A stale primary model fails on every request until cooldown parks
 * it. Fetching is the one moment the truth is known, so the caller overwrites
 * both fields from it.
 *
 * Rules:
 * - `rotationModels` is overwritten with its intersection with the fetched
 *   list, preserving the survivor order. Fetched-but-unchecked models are
 *   never added — selection stays the user's.
 * - The primary is re-pinned to the first selected model whenever it differs:
 *   selection is the single source of truth, so an unchecked primary must not
 *   linger in the rotation pool merely because the provider still serves it.
 * - With no selected model surviving there is nothing to derive from; the
 *   current primary is kept (gateways may serve models their list endpoint
 *   omits, and the pool still needs a head).
 *
 * Returns null when nothing would change, so callers can skip the write (and
 * its schema revalidation) entirely.
 */
export function reconcileSavedModels(
  providerModel: NonNullable<LLMProviderConfig["model"]>,
  fetchedModelIds: string[],
): SavedModelsSync | null {
  const valid = new Set(fetchedModelIds)
  const saved = providerModel.rotationModels ?? []
  const nextRotationModels = saved.filter((model) => valid.has(model))
  const prunedCount = saved.length - nextRotationModels.length

  const primary = resolveModelId(providerModel)
  // The primary always tracks the first selected model — selection is the
  // single source of truth, so an unchecked primary must not linger in the
  // rotation pool just because the provider still serves it. With no
  // survivor there is nothing to derive; keep the current primary.
  const firstSurvivor = nextRotationModels[0]
  const replacement =
    firstSurvivor !== undefined && firstSurvivor !== primary ? firstSurvivor : undefined
  if (prunedCount === 0 && replacement === undefined) return null

  return {
    model: {
      ...providerModel,
      ...(replacement !== undefined ? { model: replacement } : {}),
      rotationModels: nextRotationModels,
    },
    prunedCount,
    primaryReplaced: replacement !== undefined,
  }
}
