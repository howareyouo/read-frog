import { Provider as JotaiProvider } from "jotai"
import { useMemo } from "react"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import type { ControlsConfig } from "@/entrypoints/subtitles.content/platforms"
import type { SubtitlesProvidersAdapter } from "@/entrypoints/subtitles.content/universal-adapter"
import { createContextWithHook } from "@/utils/react/context"
import { subtitlesStore } from "../atoms"

interface SubtitlesUIContextValue {
  toggleSubtitles: (enabled: boolean) => void
  downloadSourceSubtitles: () => Promise<void>
  downloadTranslatedSubtitles: () => Promise<void>
  controlsConfig?: ControlsConfig
  embedded?: boolean
  openBelow?: boolean
  containerShrinkRatio?: (container: HTMLElement) => number | null
}

export const { Context: SubtitlesUIContext, useRequiredContext } =
  createContextWithHook<SubtitlesUIContextValue>(
    "useSubtitlesUI must be used within SubtitlesUIContext",
  )

export function useSubtitlesUI() {
  return useRequiredContext()
}

export function SubtitlesProviders({
  adapter,
  children,
  openBelow,
}: {
  adapter: SubtitlesProvidersAdapter
  children: React.ReactNode
  openBelow?: boolean
}) {
  const contextValue = useMemo(
    () => ({
      toggleSubtitles: adapter.toggleSubtitlesManually,
      downloadSourceSubtitles: adapter.downloadSourceSubtitles,
      downloadTranslatedSubtitles: adapter.downloadTranslatedSubtitles,
      controlsConfig: adapter.getControlsConfig(),
      embedded: adapter.embedded,
      openBelow,
      containerShrinkRatio: adapter.containerShrinkRatio,
    }),
    [adapter, openBelow],
  )

  return (
    <JotaiProvider store={subtitlesStore}>
      <SubtitlesUIContext value={contextValue}>
        <TooltipProvider>{children}</TooltipProvider>
      </SubtitlesUIContext>
    </JotaiProvider>
  )
}
