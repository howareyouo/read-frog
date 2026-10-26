import { APICallError } from "ai"
import { getErrorMessage } from "@/utils/error/message"
import { i18n } from "@/utils/i18n"

/**
 * Turn a provider failure into something worth showing on screen.
 *
 * Lives in its own module because both sides need it: the content script to
 * message a wholesale failure, and the background — which now owns per-cue
 * admission — to attach a readable reason to the cues that failed without
 * dragging the content-side translation module into the service worker.
 */
export function toFriendlyTranslationErrorMessage(error: unknown): string {
  if (error instanceof APICallError) {
    switch (error.statusCode) {
      case 429:
        return i18n.t("subtitles.errors.aiRateLimited")
      case 401:
      case 403:
        return i18n.t("subtitles.errors.aiAuthFailed")
      case 500:
      case 502:
      case 503:
        return i18n.t("subtitles.errors.aiServiceUnavailable")
      default:
        break
    }
  }

  const message = getErrorMessage(error)

  if (message.includes("No Response") || message.includes("Empty response")) {
    return i18n.t("subtitles.errors.aiNoResponse")
  }

  return message
}
