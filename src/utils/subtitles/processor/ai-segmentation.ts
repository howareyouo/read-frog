import { MAX_CUE_DURATION_MS, MAX_GAP_MS, MIN_CUE_DURATION_MS } from "@/utils/constants/subtitles"
import { sendMessage } from "@/utils/message"
import type { SerializableProviderRef } from "@/utils/providers/provider-ref"
import { WHITESPACE_PATTERN } from "@/utils/subtitles/text"
import type { SubtitlesFragment } from "../types"
import { optimizeSubtitles } from "./optimizer"

export function cleanFragmentsForAi(fragments: SubtitlesFragment[]): SubtitlesFragment[] {
  return fragments
    .map((fragment) => ({
      ...fragment,
      // \s already spans newlines, so one collapse pass normalizes line breaks too.
      text: fragment.text.replace(WHITESPACE_PATTERN, " ").trim(),
    }))
    .filter((fragment) => fragment.text.length > 0)
}

export function formatFragmentsToJson(fragments: SubtitlesFragment[]): string {
  return JSON.stringify(
    fragments.map((f) => ({
      s: f.start,
      e: f.end,
      t: f.text,
    })),
  )
}

/**
 * Parse simplified VTT content returned from AI to fragments
 * Formats accepted on a cue line:
 *   "1000 --> 1500"                        (plain milliseconds, the prompt's format)
 *   "00:01.000 --> 00:02.500"              (standard VTT clock, models slip into this)
 */
const CUE_SEPARATOR = "-->"

export function parseSimplifiedVttToFragments(vtt: string): SubtitlesFragment[] {
  const fragments: SubtitlesFragment[] = []
  const lines = vtt.trim().split("\n")

  let lineIndex = 0
  // Skip WEBVTT header
  while (lineIndex < lines.length && !lines[lineIndex]!.includes(CUE_SEPARATOR)) {
    lineIndex++
  }

  while (lineIndex < lines.length) {
    const line = lines[lineIndex]!.trim()
    const cue = parseCueTimestampLine(line)

    if (cue) {
      // Collect text lines
      const textLines: string[] = []
      lineIndex++
      while (
        lineIndex < lines.length &&
        lines[lineIndex]!.trim() !== "" &&
        !lines[lineIndex]!.includes(CUE_SEPARATOR)
      ) {
        textLines.push(lines[lineIndex]!.trim())
        lineIndex++
      }

      if (textLines.length > 0) {
        fragments.push({
          text: textLines.join("\n"),
          start: cue.start,
          end: cue.end,
        })
      }
    } else {
      lineIndex++
    }
  }

  return fragments
}

function parseCueTimestampLine(line: string): { start: number; end: number } | null {
  const separatorIndex = line.indexOf(CUE_SEPARATOR)
  if (separatorIndex < 0) return null

  const start = parseVttTimestampMs(line.slice(0, separatorIndex))
  const end = parseVttTimestampMs(line.slice(separatorIndex + CUE_SEPARATOR.length))
  if (start === null || end === null) return null
  return { start, end }
}

function parseVttTimestampMs(raw: string): number | null {
  const value = raw.trim()
  if (!value) return null

  // Plain milliseconds: "1000"
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10)
  }

  // Standard VTT clock: [HH:]MM:SS.mmm — comma also tolerated (SRT style).
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value)
  if (!clock) return null

  const hours = clock[1] ? Number.parseInt(clock[1], 10) : 0
  const minutes = Number.parseInt(clock[2]!, 10)
  const seconds = Number.parseInt(clock[3]!, 10)
  const millis = Number.parseInt(clock[4]!.padEnd(3, "0"), 10)
  return (hours * 3_600 + minutes * 60 + seconds) * 1_000 + millis
}

export interface SegmentationWindow {
  windowStartMs: number
  windowEndMs: number
}

/**
 * Put model output back inside the window it was asked about, and make it playable.
 *
 * The model writes the timestamps, and nothing downstream checks them: a hallucinated
 * `0 --> 3600000`, an inverted pair, or two cues that overlap would all travel straight
 * into the playback list. On screen that reads as subtitles that are late, early, or
 * frozen on one line. Everything here is a repair the caller can rely on:
 * non-finite and inverted cues are dropped, cues are clamped into the window, and
 * overlaps are resolved by pushing the later cue forward to where the earlier one ends.
 */
export function sanitizeSegmentedFragments(
  fragments: SubtitlesFragment[],
  { windowStartMs, windowEndMs }: SegmentationWindow,
): SubtitlesFragment[] {
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs)) {
    return []
  }
  if (windowEndMs - windowStartMs < MIN_CUE_DURATION_MS) {
    return []
  }

  const sanitized: SubtitlesFragment[] = []

  for (const fragment of fragments) {
    const text = fragment.text.trim()
    if (!text) continue
    if (!Number.isFinite(fragment.start) || !Number.isFinite(fragment.end)) continue
    if (fragment.end <= fragment.start) continue
    if (fragment.end <= windowStartMs || fragment.start >= windowEndMs) continue

    const latestStart = windowEndMs - MIN_CUE_DURATION_MS
    const start = Math.min(Math.max(fragment.start, windowStartMs), latestStart)
    const end = Math.min(Math.max(fragment.end, start + MIN_CUE_DURATION_MS), windowEndMs)

    sanitized.push({ text, start, end })
  }

  sanitized.sort((a, b) => a.start - b.start || a.end - b.end)

  // Resolve overlaps in place; a cue squeezed to nothing by the one before it is
  // dropped rather than left as a cue that can never be displayed.
  const result: SubtitlesFragment[] = []
  for (const fragment of sanitized) {
    const previous = result.at(-1)
    const start = previous ? Math.max(fragment.start, previous.end) : fragment.start
    if (fragment.end - start < MIN_CUE_DURATION_MS) {
      continue
    }
    result.push({ ...fragment, start })
  }

  return result
}

/**
 * True when any cue is long enough to look stuck on screen.
 *
 * A well-behaved model anchors each cue to real word timings, so no single cue should
 * outlast {@link MAX_CUE_DURATION_MS}. One that does means the timestamps have drifted
 * or collapsed onto the whole window, and the rule-based pass over the raw chunk is the
 * safer thing to show.
 */
export function hasOversizedCue(fragments: readonly SubtitlesFragment[]): boolean {
  return fragments.some((fragment) => fragment.end - fragment.start > MAX_CUE_DURATION_MS)
}

/**
 * True when `candidate` leaves a span of `source` uncovered for more than {@link MAX_GAP_MS}.
 *
 * Both lists are merged into coverage intervals first, then walked with two pointers:
 * each list is disjoint and start-sorted after merging, so this is linear rather than
 * the pairwise scan it replaced.
 */
export function hasTimingCoverageGap(
  source: readonly SubtitlesFragment[],
  candidate: readonly SubtitlesFragment[],
): boolean {
  const sourceCoverage = mergeCoverageIntervals(source)
  const candidateCoverage = mergeCoverageIntervals(candidate)

  let candidateIndex = 0
  for (const sourceInterval of sourceCoverage) {
    let coveredUntil = sourceInterval.start

    // Candidates ending before this source interval can never help later ones either.
    while (
      candidateIndex < candidateCoverage.length &&
      candidateCoverage[candidateIndex]!.end <= coveredUntil
    ) {
      candidateIndex++
    }

    for (let i = candidateIndex; i < candidateCoverage.length; i++) {
      const interval = candidateCoverage[i]!
      if (interval.start >= sourceInterval.end) break

      const overlapStart = Math.max(interval.start, sourceInterval.start)
      if (overlapStart - coveredUntil > MAX_GAP_MS) return true

      coveredUntil = Math.max(coveredUntil, Math.min(interval.end, sourceInterval.end))
      if (coveredUntil >= sourceInterval.end) break
    }

    if (sourceInterval.end - coveredUntil > MAX_GAP_MS) return true
  }

  return false
}

function mergeCoverageIntervals(fragments: readonly SubtitlesFragment[]): Array<{
  start: number
  end: number
}> {
  const intervals = fragments
    .filter((fragment) => fragment.end > fragment.start)
    .map((fragment) => ({ start: fragment.start, end: fragment.end }))
    .sort((a, b) => a.start - b.start)

  const merged: Array<{ start: number; end: number }> = []

  for (const interval of intervals) {
    const previous = merged.at(-1)
    if (previous && interval.start - previous.end <= MAX_GAP_MS) {
      previous.end = Math.max(previous.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }

  return merged
}

/** How an AI segmentation attempt ended. */
export type SegmentationOutcome =
  /** Model output passed validation; ready-to-serve optimized cues. */
  | { status: "ok"; fragments: SubtitlesFragment[] }
  /** The model answered but its timings are unusable — rule-based fallback, not retried. */
  | { status: "invalid" }
  /** The AI call itself failed — rule-based fallback, retryable via failed-start bookkeeping. */
  | { status: "error" }

/**
 * Segment one chunk with the AI model and gate the result on every quality check the
 * callers share: window sanitize, oversized-cue tripwire, and source-coverage gap.
 *
 * Both the live pipeline and the SRT export used to run divergent validators here,
 * which meant watched captions and exported files could disagree on what a good
 * segmentation is. Any failure falls back to the rule-based optimization of the raw
 * chunk; the caller distinguishes "invalid" from "error" only to decide whether the
 * chunk may be retried later.
 */
export async function segmentChunkWithFallback(
  chunk: SubtitlesFragment[],
  providerRef: SerializableProviderRef,
  language: string,
): Promise<SegmentationOutcome> {
  const windowStartMs = chunk[0]?.start
  const windowEndMs = chunk.at(-1)?.end
  if (windowStartMs === undefined || windowEndMs === undefined) {
    return { status: "invalid" }
  }

  try {
    const segmented = await aiSegmentBlock(chunk, providerRef)
    const sanitized = sanitizeSegmentedFragments(segmented, {
      windowStartMs,
      windowEndMs,
    })
    if (sanitized.length === 0 || hasOversizedCue(sanitized)) {
      return { status: "invalid" }
    }

    const optimized = optimizeSubtitles(sanitized, language)
    if (hasTimingCoverageGap(chunk, optimized)) {
      return { status: "invalid" }
    }

    return { status: "ok", fragments: optimized }
  } catch {
    return { status: "error" }
  }
}

/**
 * Perform AI segmentation on a block of subtitle fragments.
 *
 * `providerRef` is resolved once per session/run by the caller.
 */
export async function aiSegmentBlock(
  fragments: SubtitlesFragment[],
  providerRef: SerializableProviderRef,
): Promise<SubtitlesFragment[]> {
  if (fragments.length === 0) {
    return fragments
  }

  const cleanedFragments = cleanFragmentsForAi(fragments)

  if (cleanedFragments.length === 0) {
    return fragments
  }

  const jsonContent = formatFragmentsToJson(cleanedFragments)

  const segmentedVtt = await sendMessage("aiSegmentSubtitles", {
    jsonContent,
    providerRef,
  })

  const segmentedFragments = parseSimplifiedVttToFragments(segmentedVtt)

  if (segmentedFragments.length === 0) {
    throw new Error("AI segmentation returned empty result")
  }

  return segmentedFragments
}
