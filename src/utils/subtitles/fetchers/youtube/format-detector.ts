import { WHITESPACE_PATTERN } from "@/utils/subtitles/text"
import { cleanCueText, getEventText } from "./event-utils"
import type { YoutubeTimedText } from "./types"

export type SubtitleFormat =
  | "animated"
  | "karaoke"
  | "karaoke-stylized"
  | "scrolling-asr"
  | "standard"

const SLASH_PATTERN = /\//g
const STYLIZED_GAP_MS = 400
const MIN_STYLIZED_MATCHES = 3

function normalizeStylizedText(text: string): string {
  return cleanCueText(text)
    .replace(SLASH_PATTERN, "")
    .replace(WHITESPACE_PATTERN, " ")
    .trim()
    .toLowerCase()
}

/**
 * Detect classic karaoke format subtitles.
 * Feature: multiple events at the same timestamp with different wpWinPosId values.
 */
function isKaraokeFormat(events: YoutubeTimedText[]): boolean {
  if (events.length < 2) return false

  const firstPosIdByTime = new Map<number, number>()
  for (const event of events) {
    if (event.wpWinPosId === undefined) continue

    const existing = firstPosIdByTime.get(event.tStartMs)
    if (existing === undefined) {
      firstPosIdByTime.set(event.tStartMs, event.wpWinPosId)
    } else if (existing !== event.wpWinPosId) {
      return true
    }
  }

  return false
}

/**
 * Detect stylized karaoke subtitles where the same line is redrawn frequently on a
 * single track with slash-based syllable markers and zero-width spacing.
 */
function isStylizedKaraokeFormat(events: YoutubeTimedText[]): boolean {
  if (events.length < 4) return false

  const tracks = new Map<number, YoutubeTimedText[]>()
  for (const event of events) {
    if (event.wpWinPosId === undefined) continue

    const trackEvents = tracks.get(event.wpWinPosId)
    if (trackEvents) {
      trackEvents.push(event)
    } else {
      tracks.set(event.wpWinPosId, [event])
    }
  }

  for (const trackEvents of tracks.values()) {
    if (trackEvents.length < 4) continue

    let stylizedMatches = 0
    let previousNormalized = ""
    let previousTime = 0

    for (const event of trackEvents) {
      const rawText = getEventText(event)
      const cleanedText = cleanCueText(rawText)
      const normalizedText = normalizeStylizedText(rawText)

      if (!cleanedText || !normalizedText) continue

      const hasStylizedMarkers = rawText.includes("/") || rawText.includes("\u200B")

      const isCloseInTime =
        previousNormalized.length > 0 && event.tStartMs - previousTime <= STYLIZED_GAP_MS

      const isDuplicateOrExpansion =
        isCloseInTime &&
        (normalizedText === previousNormalized ||
          normalizedText.startsWith(previousNormalized) ||
          previousNormalized.startsWith(normalizedText))

      if (hasStylizedMarkers && isDuplicateOrExpansion) {
        stylizedMatches += 1
        if (stylizedMatches >= MIN_STYLIZED_MATCHES) return true
      }

      previousNormalized = normalizedText
      previousTime = event.tStartMs
    }
  }

  return false
}

/**
 * Detect ASR scrolling subtitle format.
 * Feature: events with wWinId and aAppend: 1.
 */
function isScrollingAsrFormat(events: YoutubeTimedText[]): boolean {
  return events.some((event) => event.wWinId !== undefined && event.aAppend === 1)
}

const ANIMATED_DURATION_THRESHOLD_MS = 100
const ANIMATED_MIN_EVENTS = 50
const ANIMATED_SHORT_DURATION_RATIO = 0.5

/**
 * Detect animated/kinetic typography subtitles.
 * Feature: most events are ultra-short animation frames (< 100ms) with wpWinPosId.
 * Used in music videos where text bounces/scrolls across the screen.
 */
function isAnimatedFormat(events: YoutubeTimedText[]): boolean {
  if (events.length < ANIMATED_MIN_EVENTS) return false

  let shortWithPos = 0
  for (const event of events) {
    if (
      event.wpWinPosId !== undefined &&
      (event.dDurationMs ?? 0) <= ANIMATED_DURATION_THRESHOLD_MS
    ) {
      shortWithPos += 1
    }
  }

  return shortWithPos / events.length >= ANIMATED_SHORT_DURATION_RATIO
}

/**
 * Detect subtitle format type.
 */
export function detectFormat(events: YoutubeTimedText[]): SubtitleFormat {
  if (!events || events.length === 0) return "standard"

  if (isAnimatedFormat(events)) return "animated"

  if (isStylizedKaraokeFormat(events)) return "karaoke-stylized"

  if (isKaraokeFormat(events)) return "karaoke"

  if (isScrollingAsrFormat(events)) return "scrolling-asr"

  return "standard"
}
