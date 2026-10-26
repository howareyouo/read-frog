/**
 * Message extraction for `unknown` catches, matching the long-standing inline
 * idiom `error instanceof Error ? error.message : String(error)`.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Normalize an unknown thrown value into an `Error` (preserving the original
 * as `cause` when it was not already an Error).
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(getErrorMessage(error), { cause: error })
}

/**
 * Rethrow helper for parse blocks: wraps the failure in an `Error` prefixed
 * with the given label, keeping the original as `cause`.
 */
export function wrapParseError(message: string, error: unknown): Error {
  return new Error(`${message}: ${getErrorMessage(error)}`, { cause: error })
}
