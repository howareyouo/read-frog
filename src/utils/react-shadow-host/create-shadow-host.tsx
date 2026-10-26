import type { ReactElement } from "react"
import { createContext } from "react"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import type { Theme } from "@/types/config/theme"
import { mountReactShadowUi } from "./mount-react-shadow-ui"

export const ShadowWrapperContext = createContext<HTMLElement | null>(null)

const SHADOW_HOST_CLEANUP_KEY = "__reactShadowContainerCleanup"

/**
 * Stashes the teardown of a host's React root on the host itself, so code that
 * only holds the DOM node (mount dedup, the translation sweeper) can unmount it.
 */
export function stashShadowHostCleanup(host: HTMLElement, cleanup: () => void): void {
  ;(host as unknown as Record<string, unknown>)[SHADOW_HOST_CLEANUP_KEY] = cleanup
}

export function getShadowHostCleanup(host: HTMLElement): (() => void) | undefined {
  return (host as unknown as Record<string, unknown>)[SHADOW_HOST_CLEANUP_KEY] as
    | (() => void)
    | undefined
}

export function createReactShadowHost(
  component: ReactElement,
  options: {
    position: "inline" | "block"
    inheritStyles: boolean
    className?: string
    cssContent?: string[]
    style?: Partial<CSSStyleDeclaration>
    forcedTheme?: Theme
  },
) {
  const { className, position, inheritStyles, cssContent, style, forcedTheme } = options

  const shadowHost = document.createElement("div")
  if (className) shadowHost.className = className

  // The caller places the host (a translated wrapper node, a platform player
  // bar); this function only builds and renders it.
  const cleanup = mountReactShadowUi({
    cssContent,
    host: shadowHost,
    inheritStyles,
    position,
    style,
    target: null,
    render: ({ container }) => (
      <ShadowWrapperContext value={container}>
        <ThemeProvider container={container} forcedTheme={forcedTheme}>
          <TooltipProvider>{component}</TooltipProvider>
        </ThemeProvider>
      </ShadowWrapperContext>
    ),
  })
  stashShadowHostCleanup(shadowHost, cleanup)

  return shadowHost
}

export function removeReactShadowHost(shadowHost: HTMLElement) {
  if (!(shadowHost as unknown as Record<string, unknown>).__reactShadowContainerCleaned) {
    getShadowHostCleanup(shadowHost)?.()
    ;(shadowHost as unknown as Record<string, unknown>).__reactShadowContainerCleaned = true
  }
  shadowHost.remove()
}
