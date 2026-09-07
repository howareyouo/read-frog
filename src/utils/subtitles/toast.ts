import { toastManager } from "@/components/ui/base-ui/toast"
import { sendMessage } from "@/utils/message"
import type { SubtitlesErrorAction } from "./errors"

/** Stable, so a double-click refreshes one toast instead of stacking two. */
const WALL_TOAST_ID = "read-frog-subtitles-wall"
/**
 * Longer than the shared default (5s): this toast is the only place the
 * refusal is explained, and it asks the reader to aim at a button rather than
 * just acknowledge a line of text.
 */
const WALL_TOAST_TIMEOUT_MS = 10_000

/**
 * The one shape every subtitles denial takes: a sentence saying what happened,
 * plus an optional button the user chooses to press. Deliberately never
 * navigates on its own — stealing focus with a new tab in the middle of a
 * video is what this replaces.
 */
export function showSubtitlesErrorToast(title: string, action?: SubtitlesErrorAction): void {
  const toastId = toastManager.add({
    id: WALL_TOAST_ID,
    type: "error",
    title,
    timeout: WALL_TOAST_TIMEOUT_MS,
    ...(action && {
      actionProps: {
        children: action.label,
        onClick: () => {
          toastManager.close(toastId)
          // Content scripts cannot use chrome.tabs — route through the background.
          void sendMessage("openPage", { url: action.url, active: true })
        },
      },
    }),
  })
}
