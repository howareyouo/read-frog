import { createContext, useContext } from "react"

/**
 * Create a React context together with the hook that reads it, throwing when
 * the hook runs outside a provider. Replaces the repeated
 * `createContext(null)` + null-guard hook boilerplate; the raw `Context` stays
 * exported for the provider to render and for optional (nullable) reads.
 */
export function createContextWithHook<T>(errorMessage: string) {
  const Context = createContext<T | null>(null)
  function useRequiredContext(): T {
    const context = useContext(Context)
    if (!context) {
      throw new Error(errorMessage)
    }
    return context
  }
  return { Context, useRequiredContext } as const
}
