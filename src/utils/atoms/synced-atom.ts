import { atom, type PrimitiveAtom } from "jotai"
import { logger } from "../logger"

interface SyncedAtomOptions<T> {
  /** Reads the current external value; also re-run when the tab becomes visible again. */
  load: () => Promise<T>
  /** Subscribes to external updates; must return an unsubscribe function. */
  subscribe: (onUpdate: (value: T) => void) => () => void
  /**
   * Skip applying the initial load result when an external update already
   * arrived first, so a late initial read cannot overwrite fresher data.
   */
  dropStaleInitialLoad?: boolean
  /** Atom name used in the visibilitychange log line. */
  logLabel: string
}

/**
 * Create a primitive atom that stays in sync with an external source:
 *
 * 1. Initial load: `load()` runs when the atom first mounts.
 * 2. Cross-context updates: `subscribe()` keeps the atom live (popup, options
 *    page, other tabs, ...).
 * 3. Tab reactivation: `load()` re-runs on `visibilitychange` because inactive
 *    tabs may miss updates. See https://github.com/mengxi-ream/read-frog/issues/435
 */
export function createSyncedAtom<T>(
  initialValue: T,
  options: SyncedAtomOptions<T>,
): PrimitiveAtom<T> {
  const syncedAtom = atom<T>(initialValue)

  syncedAtom.onMount = (setAtom: (newValue: T) => void) => {
    let didReceiveExternalUpdate = false

    void options.load().then((value) => {
      if (!options.dropStaleInitialLoad || !didReceiveExternalUpdate) {
        setAtom(value)
      }
    })

    const unsubscribe = options.subscribe((value) => {
      didReceiveExternalUpdate = true
      setAtom(value)
    })

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        logger.info(`${options.logLabel} onMount handleVisibilityChange when: `, new Date())
        void options.load().then(setAtom)
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      unsubscribe()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }

  return syncedAtom
}
