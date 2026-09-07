import type { SubtitlesFragment } from "../../types"
import type { YoutubeTimedText } from "./types"

export { cleanCueText, WHITESPACE_PATTERN, ZERO_WIDTH_SPACE_PATTERN } from "../../text"

/**
 * Raw concatenated text of an event's segs, with no cleaning applied. Detection
 * code needs the raw form (to spot `/` and zero-width markers); parsers clean it.
 */
export function getEventText(event: YoutubeTimedText): string {
  return (event.segs ?? []).map((seg) => seg.utf8 || "").join("")
}

/**
 * Append a cue to a result list that is being built in start order, clamping the
 * previous cue's end to the new cue's start so the two never overlap. Every
 * YouTube parser emits cues this way.
 */
export function pushFragmentClamped(
  result: SubtitlesFragment[],
  fragment: SubtitlesFragment,
): void {
  const last = result.at(-1)
  if (last && last.end > fragment.start) {
    last.end = fragment.start
  }
  result.push(fragment)
}
