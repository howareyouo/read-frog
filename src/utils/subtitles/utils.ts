import { MAX_CHARS_CJK, MAX_WORDS } from "@/utils/constants/subtitles"
import { WHITESPACE_PATTERN } from "./text"
import type { SubtitlesFragment } from "./types"

export function isCJKLanguage(lang?: string): boolean {
  if (!lang) return false
  return ["zh", "ja", "ko", "th", "lo", "km", "my"].some((l) => lang.startsWith(l))
}

export function getTextLength(text: string, isCJK: boolean): number {
  if (isCJK) {
    return text.length
  }
  return text.split(WHITESPACE_PATTERN).filter(Boolean).length
}

export function getMaxLength(isCJK: boolean): number {
  if (isCJK) {
    return MAX_CHARS_CJK
  }
  return MAX_WORDS
}

/**
 * First index whose cue starts at or after `startMs`.
 *
 * Callers pass start-sorted cue lists — every producer here (optimizer output,
 * `replaceFragmentWindow`, the scheduler's upserts) maintains that order.
 */
export function lowerBoundByStart(
  fragments: readonly SubtitlesFragment[],
  startMs: number,
): number {
  let low = 0
  let high = fragments.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (fragments[mid]!.start < startMs) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

/**
 * Stable merge of two start-sorted cue lists. Equal starts keep the left list's
 * cue first, matching the sort the per-call-site code used to do.
 */
export function mergeSortedByStart(
  left: readonly SubtitlesFragment[],
  right: readonly SubtitlesFragment[],
): SubtitlesFragment[] {
  const merged: SubtitlesFragment[] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i]!.start <= right[j]!.start) {
      merged.push(left[i++]!)
    } else {
      merged.push(right[j++]!)
    }
  }
  while (i < left.length) merged.push(left[i++]!)
  while (j < right.length) merged.push(right[j++]!)
  return merged
}

/**
 * Replace the cue window [windowStartMs, windowEndMs) with `nextFragments`,
 * keeping every cue outside it. All inputs and the result are start-sorted.
 *
 * This is the one "recut landed" primitive shared by the segmentation pipeline,
 * the source-track publisher, and the scheduler's translation reconciler.
 */
export function replaceFragmentWindow(
  fragments: readonly SubtitlesFragment[],
  windowStartMs: number,
  windowEndMs: number,
  nextFragments: readonly SubtitlesFragment[],
): SubtitlesFragment[] {
  const kept = fragments.filter(
    (fragment) => fragment.end <= windowStartMs || fragment.start >= windowEndMs,
  )
  return mergeSortedByStart(kept, nextFragments)
}

/**
 * The cue that should be on screen at `timeMs`.
 *
 * Cues can legitimately overlap — a translated cue that has not been dropped after an
 * AI recut, or a native track with rolling two-line windows. Picking the *earliest*
 * match keeps a stale line on screen for as long as the overlap lasts and reads as
 * "the subtitles are out of sync". The line the viewer expects is the one that started
 * most recently, so that is what this resolves.
 */
export function findActiveCue(
  fragments: readonly SubtitlesFragment[],
  timeMs: number,
): SubtitlesFragment | null {
  const index = findActiveCueIndex(fragments, timeMs)
  return index >= 0 ? (fragments[index] ?? null) : null
}

/**
 * Index of {@link findActiveCue}, or -1 when nothing covers `timeMs`. Callers that
 * track "did the cue change" compare indexes rather than object identity, because a
 * recut can hand back a fresh object for the very same line.
 *
 * Deliberately order-independent (any overlap arrangement resolves to the
 * latest-starting cover) and linear: the scheduler's O(1) "current cue still
 * covers now" fast path keeps this off the per-frame hot loop, so the scan only
 * runs on cue changes and gaps.
 */
export function findActiveCueIndex(
  fragments: readonly SubtitlesFragment[],
  timeMs: number,
): number {
  let activeIndex = -1

  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]!
    if (fragment.start > timeMs || fragment.end <= timeMs) {
      continue
    }
    const active = fragments[activeIndex]
    if (!active || fragment.start >= active.start) {
      activeIndex = i
    }
  }

  return activeIndex
}
