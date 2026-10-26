import { browser } from "#imports"

export function isNonNullish<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined
}

export function getActiveTabUrl() {
  return browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]!.url)
}

export function getDateFromDaysBack(daysBack: number) {
  const date = new Date()
  date.setDate(date.getDate() - daysBack)
  return date
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/**
 * Wrap an async initializer so it runs at most once: every call shares the same
 * promise. A rejection stays cached (no automatic retry) — reset with `run.reset`
 * when the underlying state may have changed.
 */
export function memoizePromise<T>(fn: () => Promise<T>) {
  let promise: Promise<T> | undefined
  const run = () => {
    if (promise === undefined) {
      promise = fn()
    }
    return promise
  }
  run.reset = () => {
    promise = undefined
  }
  return run
}
