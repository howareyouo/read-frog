import {
  MAX_WORDS,
  MIN_CUE_DURATION_MS,
  PAUSE_TIMEOUT_MS,
  SENTENCE_END_PATTERN,
} from "@/utils/constants/subtitles"
import { WHITESPACE_PATTERN } from "@/utils/subtitles/text"
import { getMaxLength, getTextLength, isCJKLanguage } from "@/utils/subtitles/utils"
import type { SubtitlesFragment } from "../types"

const STARTS_WITH_SIGN_PATTERN = /^[[(♪]/

/**
 * Once a run reaches this share of the budget it may break on a sentence ending.
 * Breaking earlier would shatter a long line into one-clause fragments.
 */
const SENTENCE_BREAK_MIN_RATIO = 0.5

/**
 * A whitespace-free token (a URL, an unbroken hashtag run) measures as one word, but
 * its glyph count is what hits the screen. Past roughly the width of a full 15-word
 * line (~8 characters per word) it reads as a wall of text and gets split by
 * characters instead; shorter lone tokens — including legitimately long words —
 * stay whole.
 */
const LONE_TOKEN_CHAR_LIMIT = MAX_WORDS * 8

// Preferred target range (best-effort) for rebalancing short lines.
const TARGET_MIN_CJK = 15
const TARGET_MAX_CJK = 25
const TARGET_MIN_NON_CJK = 11
const TARGET_MAX_NON_CJK = 20

const LEADING_CHEVRON_PATTERN = /^>>\s*/
const CHEVRON_PATTERN = />>/g

function stripChevrons(text: string): string {
  return text.replace(LEADING_CHEVRON_PATTERN, "").replace(CHEVRON_PATTERN, " ").trim()
}

interface BufferSegment {
  text: string
  start: number
  end: number
}

function processSubtitles(fragments: SubtitlesFragment[], language: string): SubtitlesFragment[] {
  const result: SubtitlesFragment[] = []
  const buffer: BufferSegment[] = []
  let bufferLength = 0
  const isCJK = isCJKLanguage(language)
  const separator = isCJK ? "" : " "
  const maxLength = getMaxLength(isCJK)

  const flushBuffer = () => {
    if (buffer.length === 0) return
    result.push({
      text: buffer
        .map((s) => s.text)
        .join(separator)
        .trim(),
      start: buffer[0]!.start,
      end: buffer.at(-1)!.end,
    })
    buffer.length = 0
    bufferLength = 0
  }

  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i]
    if (!frag!.text) continue

    const text = stripChevrons(frag!.text)
    if (!text) continue
    const fragLength = getTextLength(text, isCJK)
    const lastSegment = buffer.at(-1)

    if (lastSegment) {
      const isEndOfSentence = SENTENCE_END_PATTERN.test(lastSegment.text)
      const isTimeout = frag!.start - lastSegment.end > PAUSE_TIMEOUT_MS
      const wouldExceedLimit = bufferLength + fragLength > maxLength
      const startsWithSign = STARTS_WITH_SIGN_PATTERN.test(frag!.text)

      if (isEndOfSentence || isTimeout || wouldExceedLimit || startsWithSign) {
        flushBuffer()
      }
    }

    buffer.push({ text, start: frag!.start, end: frag!.end })
    bufferLength += fragLength
  }

  flushBuffer()
  return result
}

/**
 * Split text into the units the length budget counts: characters for CJK, words otherwise.
 */
function toTextUnits(text: string, isCJK: boolean): string[] {
  if (isCJK) {
    return [...text]
  }
  return text.split(WHITESPACE_PATTERN).filter(Boolean)
}

/**
 * Greedily pack units into runs of at most `maxLength`, preferring to end a run on a
 * sentence boundary once it is reasonably full.
 */
function packIntoRuns(units: string[], isCJK: boolean, maxLength: number): string[][] {
  const sentenceBreakMin = maxLength * SENTENCE_BREAK_MIN_RATIO
  const runs: string[][] = []
  let current: string[] = []
  let currentLength = 0

  for (const unit of units) {
    const unitLength = getTextLength(unit, isCJK)

    if (current.length > 0 && currentLength + unitLength > maxLength) {
      runs.push(current)
      current = []
      currentLength = 0
    }

    current.push(unit)
    currentLength += unitLength

    // The run's tail is its last unit, so testing the unit alone is equivalent
    // to testing the joined run, without re-joining on every iteration.
    if (
      currentLength >= sentenceBreakMin &&
      SENTENCE_END_PATTERN.test(current[current.length - 1]!)
    ) {
      runs.push(current)
      current = []
      currentLength = 0
    }
  }

  if (current.length > 0) {
    runs.push(current)
  }

  return runs
}

/**
 * Break one fragment whose text blows past the per-cue budget into several cues,
 * spreading the original time span across them in proportion to text length.
 *
 * `processSubtitles` only ever *merges*. Without this pass a single oversized fragment
 * survives optimization untouched — so a model returning one 60s cue, or a hand-made
 * track with a paragraph in one event, lands on screen as one immovable wall of text
 * that stays up for the whole span. Proportional timing is an estimate, but it is far
 * closer than showing the whole block for the whole span.
 */
export function splitOversizedFragment(
  fragment: SubtitlesFragment,
  language: string,
): SubtitlesFragment[] {
  const isCJK = isCJKLanguage(language)
  const maxLength = getMaxLength(isCJK)
  const text = stripChevrons(fragment.text)

  if (!text) {
    return []
  }

  // A whitespace-free token longer than a whole line cannot be word-split, and its
  // word-count length hides it from the budget check entirely. Give it its own
  // character-chunk path so it still becomes several displayable cues.
  const units = toTextUnits(text, isCJK)
  if (!isCJK && units.length === 1 && text.length > LONE_TOKEN_CHAR_LIMIT) {
    const chars = [...text]
    const chunkCount = Math.ceil(chars.length / maxLength)
    // A collapsed span (end <= start) gets the minimum duration per chunk rather
    // than producing cues that can never be selected.
    const span = Math.max(fragment.end - fragment.start, MIN_CUE_DURATION_MS * chunkCount)

    return Array.from({ length: chunkCount }, (_, index) => {
      const chunkText = chars.slice(index * maxLength, (index + 1) * maxLength).join("")
      const start = fragment.start + Math.round((index / chunkCount) * span)
      const end =
        index === chunkCount - 1
          ? fragment.start + span
          : fragment.start + Math.round(((index + 1) / chunkCount) * span)
      return { text: chunkText, start, end: Math.max(end, start + MIN_CUE_DURATION_MS) }
    })
  }

  if (getTextLength(text, isCJK) <= maxLength) {
    return [{ ...fragment, text }]
  }

  const separator = isCJK ? "" : " "
  const totalLength = units.reduce((sum, unit) => sum + getTextLength(unit, isCJK), 0)
  const runs = packIntoRuns(units, isCJK, maxLength)

  // A collapsed span (end <= start) gets the minimum duration per run rather than
  // producing cues that can never be selected.
  const span = Math.max(fragment.end - fragment.start, MIN_CUE_DURATION_MS * runs.length)
  let consumed = 0

  return runs.map((run) => {
    const runLength = run.reduce((sum, unit) => sum + getTextLength(unit, isCJK), 0)
    const start = fragment.start + Math.round((consumed / totalLength) * span)
    consumed += runLength
    const end = fragment.start + Math.round((consumed / totalLength) * span)

    return {
      text: run.join(separator).trim(),
      start,
      end: Math.max(end, start + MIN_CUE_DURATION_MS),
    }
  })
}

function getTargetBounds(isCJK: boolean): { min: number; max: number } {
  return isCJK
    ? { min: TARGET_MIN_CJK, max: TARGET_MAX_CJK }
    : { min: TARGET_MIN_NON_CJK, max: TARGET_MAX_NON_CJK }
}

function mergeSegmentPair(
  left: SubtitlesFragment,
  right: SubtitlesFragment,
  separator: string,
): SubtitlesFragment {
  return {
    ...left,
    text: `${left.text}${separator}${right.text}`.trim(),
    end: right.end,
  }
}

function shouldKeepBoundary(left: SubtitlesFragment, right: SubtitlesFragment): boolean {
  const isTimeout = right.start - left.end > PAUSE_TIMEOUT_MS
  const startsWithSign = STARTS_WITH_SIGN_PATTERN.test(right.text)
  return isTimeout || startsWithSign
}

function rebalanceToTargetRange(
  fragments: SubtitlesFragment[],
  language: string,
): SubtitlesFragment[] {
  if (fragments.length <= 1) {
    return fragments
  }

  const isCJK = isCJKLanguage(language)
  const separator = isCJK ? "" : " "
  const { min, max } = getTargetBounds(isCJK)

  const result: SubtitlesFragment[] = []

  for (let i = 0; i < fragments.length; i++) {
    let current = { ...fragments[i]! }
    let currentLength = getTextLength(current.text, isCJK)

    while (currentLength < min && i + 1 < fragments.length) {
      const next = fragments[i + 1]!
      const nextLength = getTextLength(next.text, isCJK)
      const combinedLength = currentLength + nextLength

      if (combinedLength > max || shouldKeepBoundary(current, next)) {
        break
      }

      current = mergeSegmentPair(current, next, separator)
      currentLength = combinedLength
      i++
    }

    result.push(current)
  }

  for (let i = result.length - 1; i > 0; i--) {
    const current = result[i]!
    const currentLength = getTextLength(current.text, isCJK)
    if (currentLength >= min) {
      continue
    }

    const previous = result[i - 1]!
    const previousLength = getTextLength(previous.text, isCJK)
    const combinedLength = previousLength + currentLength

    if (combinedLength > max || shouldKeepBoundary(previous, current)) {
      continue
    }

    result[i - 1] = mergeSegmentPair(previous, current, separator)
    result.splice(i, 1)
  }

  return result
}

export function optimizeSubtitles(
  fragments: SubtitlesFragment[],
  language: string,
): SubtitlesFragment[] {
  if (fragments.length === 0) return []

  // Oversized fragments have to be broken up *before* merging: processSubtitles only
  // guards against merging past the budget, so an already-too-long fragment would pass
  // straight through and pin a whole block of text to a single cue. With every cue
  // guaranteed within budget afterwards, a single merge pass suffices.
  const sized = fragments.flatMap((fragment) => splitOversizedFragment(fragment, language))

  return rebalanceToTargetRange(processSubtitles(sized, language), language)
}
