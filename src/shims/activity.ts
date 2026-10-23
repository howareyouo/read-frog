import type { ComponentChildren } from "preact"
import { createElement, Fragment } from "preact/compat"

export interface ActivityProps {
  mode: "visible" | "hidden"
  children?: ComponentChildren
}

/**
 * Minimal stand-in for React 19's `<Activity>`: preact/compat has no
 * equivalent, and the content-script builds (which alias `react` to
 * `src/shims/react.ts`) are the only place it runs. The real component
 * unmounts hidden children and tears down their effects; this keeps children
 * mounted and merely hides them, which is all the current call sites rely on.
 */
export function Activity({ mode, children }: ActivityProps) {
  if (mode === "hidden") {
    return createElement("div", { hidden: true, style: "display: none" }, children)
  }
  return createElement(Fragment, null, children)
}
