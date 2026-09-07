import { logger } from "@/utils/logger"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"

/**
 * Fetch-compatible signature accepted by the AI SDK provider factories.
 */
export type ObservedFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function describeTarget(input: string | URL | Request) {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return input.url
}

/**
 * A fetch-compatible wrapper that logs method, URL, status and duration of
 * every request. The response (and the original error) is returned untouched,
 * so callers that own error semantics — the AI SDK factories, which expect a
 * bare fetch — can adopt it without changing behavior.
 */
export function createObservedFetch(label: string): ObservedFetch {
  return async (input, init) => {
    const url = describeTarget(input)
    const method = (init?.method ?? "GET").toUpperCase()
    const startedAt = Date.now()
    try {
      const resp = await fetch(input, init)
      logger.info(`[${label}] ${method} ${url} -> ${resp.status} (${Date.now() - startedAt}ms)`)
      return resp
    } catch (error) {
      logger.warn(`[${label}] ${method} ${url} failed (${Date.now() - startedAt}ms)`, error)
      throw error
    }
  }
}

/**
 * The single HTTP exit for translation provider requests: observed logging
 * plus normalized error shaping. Network failures carry retryable "network"
 * meta; non-2xx responses carry statusCode + responseHeaders meta so the
 * RequestQueue retry policy can classify them uniformly. Error messages keep
 * the "Network error during ..." wording — retry-policy regexes match on it.
 *
 * The AI SDK path must NOT use this (it throws on non-2xx, while the SDK
 * expects the raw Response); use createObservedFetch there.
 */
export async function httpFetch(
  url: string,
  init: RequestInit | undefined,
  label: string,
): Promise<Response> {
  const resp = await createObservedFetch(label)(url, init).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    throw attachRequestErrorMeta(new Error(`Network error during ${label}: ${message}`), {
      kind: "network",
      isRetryable: true,
    })
  })

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "Unable to read error response")
    throw attachRequestErrorMeta(
      new Error(
        `${label} request failed: ${resp.status} ${resp.statusText}${
          errorText ? ` - ${errorText}` : ""
        }`,
      ),
      {
        statusCode: resp.status,
        responseHeaders: resp.headers,
      },
    )
  }

  return resp
}
