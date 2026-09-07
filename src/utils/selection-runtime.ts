/**
 * Window flag the background sets via executeScript right before injecting the
 * content script into an iframe that should run the full runtime (translation
 * AND selection UI). Translation-only iframe injections leave it unset, which
 * is how the merged entrypoint distinguishes the two — mirroring the days when
 * selection.js was a separate file only injected for full-runtime frames.
 */
export const SELECTION_ENABLED_WINDOW_KEY = "__READ_FROG_SELECTION_ENABLED__" as const

declare global {
  interface Window {
    __READ_FROG_SELECTION_ENABLED__?: boolean
  }
}

export function isSelectionRuntimeEnabled(): boolean {
  return window[SELECTION_ENABLED_WINDOW_KEY] === true
}
