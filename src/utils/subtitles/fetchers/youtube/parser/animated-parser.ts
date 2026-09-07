import type { SubtitlesFragment } from "../../../types"
import { cleanCueText, getEventText, pushFragmentClamped } from "../event-utils"
import type { YoutubeTimedText } from "../types"

export function parseAnimatedSubtitles(events: YoutubeTimedText[]): SubtitlesFragment[] {
  const fragments: SubtitlesFragment[] = []

  for (const event of events) {
    const text = cleanCueText(getEventText(event))
    if (!text) continue

    const start = event.tStartMs
    const end = start + (event.dDurationMs ?? 0)
    const last = fragments.at(-1)

    if (last && last.text === text) {
      last.end = end
    } else {
      pushFragmentClamped(fragments, { text, start, end })
    }
  }

  return fragments
}
