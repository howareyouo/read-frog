import type { RefObject } from "react"
import { useEffect } from "react"

/**
 * Resets the form whenever `value` changes externally. An autosaved form
 * re-renders with the exact values it just submitted — the storage round-trip
 * — and resetting on that echo reverts every keystroke made while the write
 * was in flight (plus a full re-validation + remount cycle), so callers record
 * each submit into `lastSubmittedRef` and matching values are skipped.
 */
export function useFormExternalReset<T>(
  form: { reset: (value: T) => void },
  value: T | null,
  lastSubmittedRef: RefObject<T | null>,
) {
  useEffect(() => {
    if (!value) return
    const lastSubmitted = lastSubmittedRef.current
    if (lastSubmitted && JSON.stringify(lastSubmitted) === JSON.stringify(value)) {
      return
    }
    form.reset(value)
  }, [value, form, lastSubmittedRef])
}
