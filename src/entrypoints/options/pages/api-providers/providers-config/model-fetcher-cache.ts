import { atom } from "jotai"
import { logger } from "@/utils/logger"

/**
 * Per-provider snapshot of the model picker, so switching providers — or
 * closing and reopening the options page — brings back the already-fetched
 * model list and picker state instead of hiding the picker and refetching on
 * every visit.
 *
 * Mirrors the translation-hub session pattern: one module-level jotai atom
 * owns the full snapshot for the running session, and only the fetch-stable
 * part (model list + the endpoint it came from + the key that fetched it) is
 * mirrored into localStorage. Transient picker UI (search text, filters,
 * batch-test marks) is kept for the session only: a fresh page start should
 * not resurrect a stale search filter that hides half the list.
 */

const CACHE_STORAGE_KEY = "api-providers-model-fetcher-cache"

/**
 * The fetch-stable part of a snapshot — the only part mirrored to localStorage.
 * `connectionURL` doubles as the staleness marker: a provider re-pointed at
 * another endpoint voids its cached list, and the next successful fetch
 * overwrites the entry.
 */
export interface PersistedModelFetcherState {
  /** Model ids exactly as the last successful fetch returned them (deduped). */
  models: string[]
  /** Endpoint the models were fetched from. */
  connectionURL: string
  /**
   * Key the cached list was fetched with. Pins restored per-model tests and
   * marks the "configuring" key row after a restore.
   */
  activeKey?: string
}

/** Full per-provider snapshot held for the session (persisted part + picker UI state). */
export interface ModelFetcherCacheState extends PersistedModelFetcherState {
  /** Search box content, restored when switching back within the session. */
  search: string
  /** "Selected only" filter, restored when switching back within the session. */
  onlySelected: boolean
  /** Settled batch-test outcomes; "pending" entries are stripped before saving. */
  batchResults: Record<string, "success" | "error">
}

type ModelFetcherCache = Record<string, ModelFetcherCacheState>

function readPersistedCache(): ModelFetcherCache {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, PersistedModelFetcherState>
    // UI state is session-only: seeded empty on every page load.
    return Object.fromEntries(
      Object.entries(parsed).map(([providerId, persisted]) => [
        providerId,
        { ...persisted, search: "", onlySelected: false, batchResults: {} },
      ]),
    )
  } catch (error) {
    logger.warn("Failed to read the model fetcher cache", error)
    return {}
  }
}

// Snapshot read once at module load; from then on the atom owns the session
// state and localStorage only receives explicit mirrors of fetch results.
const initialCache = readPersistedCache()

export const modelFetcherCacheAtom = atom<ModelFetcherCache>(initialCache)

function toPersisted(state: ModelFetcherCacheState): PersistedModelFetcherState {
  return {
    models: state.models,
    connectionURL: state.connectionURL,
    activeKey: state.activeKey,
  }
}

/**
 * Merges a picker UI patch over a snapshot (or the empty snapshot when none
 * exists yet). A freshly created entry carries no fetch result, so it can
 * never satisfy a restore: its empty `connectionURL` matches nothing.
 */
function toCacheState(
  prev: ModelFetcherCacheState | undefined,
  patch: Partial<Pick<ModelFetcherCacheState, "search" | "onlySelected" | "batchResults">>,
): ModelFetcherCacheState {
  return {
    models: prev?.models ?? [],
    connectionURL: prev?.connectionURL ?? "",
    activeKey: prev?.activeKey,
    search: prev?.search ?? "",
    onlySelected: prev?.onlySelected ?? false,
    batchResults: prev?.batchResults ?? {},
    ...patch,
  }
}

/**
 * Strips "pending" marks from a batch-result map: a snapshot must never
 * restore a row into an endless in-flight spinner, so a batch interrupted by
 * a provider switch simply drops its unfinished rows.
 */
export function settledBatchResults(
  results: Record<string, "pending" | "success" | "error">,
): Record<string, "success" | "error"> {
  const settled: Record<string, "success" | "error"> = {}
  for (const [modelId, status] of Object.entries(results)) {
    if (status === "success" || status === "error") {
      settled[modelId] = status
    }
  }
  return settled
}

function persistCache(cache: ModelFetcherCache) {
  try {
    const persisted = Object.fromEntries(
      Object.entries(cache).map(([providerId, state]) => [providerId, toPersisted(state)]),
    )
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(persisted))
  } catch (error) {
    logger.warn("Failed to persist the model fetcher cache", error)
  }
}

/**
 * Replaces a provider's fetch result (models + endpoint + key) and mirrors it
 * to localStorage: called after each successful fetch. The picker's session
 * UI state riding along in the entry is preserved.
 */
export const saveModelFetcherFetchResultAtom = atom(
  null,
  (
    get,
    set,
    params: { providerId: string; models: string[]; connectionURL: string; activeKey?: string },
  ) => {
    const cache = get(modelFetcherCacheAtom)
    const next: ModelFetcherCacheState = {
      ...toCacheState(cache[params.providerId], {}),
      models: params.models,
      connectionURL: params.connectionURL,
      activeKey: params.activeKey,
    }
    const nextCache = { ...cache, [params.providerId]: next }
    set(modelFetcherCacheAtom, nextCache)
    persistCache(nextCache)
  },
)

/**
 * Session-only patch of the picker UI state (search text, filters, batch-test
 * marks). Never persisted: a fresh page starts with a clean picker.
 */
export const patchModelFetcherUiStateAtom = atom(
  null,
  (
    get,
    set,
    params: {
      providerId: string
      patch: Partial<Pick<ModelFetcherCacheState, "search" | "onlySelected" | "batchResults">>
    },
  ) => {
    const cache = get(modelFetcherCacheAtom)
    set(modelFetcherCacheAtom, {
      ...cache,
      [params.providerId]: toCacheState(cache[params.providerId], params.patch),
    })
  },
)

/** Drops a provider's snapshot entirely — called when the provider is deleted. */
export const removeModelFetcherCacheAtom = atom(null, (get, set, providerId: string) => {
  const cache = get(modelFetcherCacheAtom)
  if (!(providerId in cache)) return
  const nextCache = { ...cache }
  delete nextCache[providerId]
  set(modelFetcherCacheAtom, nextCache)
  persistCache(nextCache)
})
