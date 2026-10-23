import type { ReactNode } from "react"

/**
 * Flattens the provider pyramid at app entrypoints. Each factory receives the
 * remaining tree as `children` and returns its provider wrapped around it;
 * factories are applied first-to-last (the first is the outermost).
 *
 * Providers render no DOM of their own, so the mounted tree is identical to
 * the equivalent nested-JSX form — this only removes source-level nesting.
 */
export function ComposeProviders({
  providers,
  children,
}: {
  providers: Array<(children: ReactNode) => ReactNode>
  children: ReactNode
}) {
  return providers.reduceRight((acc, provider) => provider(acc), children)
}
