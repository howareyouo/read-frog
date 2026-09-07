import { useEffect, useState } from "react"

/**
 * Local draft for continuous inputs (sliders, color pickers) that commit to
 * config only on release. The draft follows the committed value whenever it
 * changes externally (reset, sync from another surface).
 */
export function useCommittedDraft<T>(value: T) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setDraft(value)
  }, [value])

  return [draft, setDraft] as const
}
