import { useCallback, useEffect, useRef } from "react"

/**
 * Returns a stable callback that debounces `formForSubmit.handleSubmit` (default
 * 300ms, trailing) — a no-op when no `formForSubmit` is given, so plain field
 * components and autosave ones can share one implementation. The submit writes
 * the whole config, so firing it on every keystroke — and the resulting store
 * update re-mounting the field value — is a wasteful render loop.
 * `formForSubmit` is read through a ref so a new object on each render doesn't
 * reset the pending timer.
 */
export function useDebouncedSubmit(
  formForSubmit: { handleSubmit: () => void } | undefined,
  delay = 300,
): () => void {
  const formForSubmitRef = useRef(formForSubmit)
  formForSubmitRef.current = formForSubmit
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  return useCallback(() => {
    const submit = formForSubmitRef.current
    if (!submit) return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      submit.handleSubmit()
    }, delay)
  }, [delay])
}
