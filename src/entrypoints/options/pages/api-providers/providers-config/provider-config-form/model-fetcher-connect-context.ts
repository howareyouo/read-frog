import { createContext, useContext } from "react"

export interface ModelFetcherConnectRequest {
  /**
   * Monotonic counter bumped on every "connect" click, so a reconnect refetches
   * the model list even when the key did not change. The key field's own edits
   * never bump it, so typing after a connect does not refire the fetch.
   */
  requestId: number
  /**
   * The API key of the row whose "connect" was clicked. The model picker
   * fetches with it and pins per-model tests to it, letting a rotation key be
   * verified on its own. Absent falls back to the provider's primary key.
   */
  apiKey?: string
  /**
   * True when this request was restored from the model fetcher cache instead
   * of coming from a connect click: the picker must show the cached list
   * as-is, not refetch. The next real connect click drops the flag.
   */
  hydrated?: boolean
}

export interface ModelFetcherConnectApi {
  /** Latest connect request, or null before the first connect of this mount. */
  state: ModelFetcherConnectRequest | null
  connect: (apiKey?: string) => void
}

/**
 * Connects the API key rows (which sit above the model picker) to the
 * ModelFetcher below them. Clicking "connect" on a key row must not probe the
 * endpoint itself; it asks the picker to fetch the provider's model list and
 * make every model individually testable instead.
 */
export const ModelFetcherConnectContext = createContext<ModelFetcherConnectApi | null>(null)

export function useModelFetcherConnectApi(): ModelFetcherConnectApi {
  const context = useContext(ModelFetcherConnectContext)
  if (!context) {
    throw new Error(
      "useModelFetcherConnectApi must be used inside a provider editor with a connect gate",
    )
  }
  return context
}
