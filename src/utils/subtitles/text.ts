/**
 * Shared text/whitespace primitives for subtitle text handling.
 *
 * These used to be re-declared per file (nine copies of the whitespace pattern
 * alone, with and without the global flag). Every consumer collapses runs of
 * whitespace or strips zero-width spaces, so they live here once.
 */

export const WHITESPACE_PATTERN = /\s+/g

export const ZERO_WIDTH_SPACE_PATTERN = /\u200B/g

/** Replace runs of whitespace with a single space. */
export function collapseWhitespace(text: string): string {
  return text.replace(WHITESPACE_PATTERN, " ")
}

/** Drop zero-width spaces, collapse whitespace runs, trim both ends. */
export function cleanCueText(text: string): string {
  return text.replace(ZERO_WIDTH_SPACE_PATTERN, "").replace(WHITESPACE_PATTERN, " ").trim()
}
