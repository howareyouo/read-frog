import themeCSS from "@/assets/styles/subtitles.css?inline"
import type { PlatformConfig } from "@/entrypoints/subtitles.content/platforms"
import { READ_FROG_SUBTITLES_UI_HOST_ID, SUBTITLES_THEME } from "@/utils/constants/subtitles"
import { waitForElement } from "@/utils/dom/wait-for-element"
import { LocaleBoundary } from "@/utils/i18n/locale-boundary"
import { ShadowWrapperContext } from "@/utils/react-shadow-host/create-shadow-host"
import { mountReactShadowUi } from "@/utils/react-shadow-host/mount-react-shadow-ui"
import { SubtitlesContainer } from "../ui/subtitles-container"
import { SubtitlesProviders } from "../ui/subtitles-ui-context"
import type { SubtitlesProvidersAdapter } from "../universal-adapter"
import { mountSubtitlesToast } from "./mount-subtitles-toast"

interface MountSubtitlesUIOptions {
  adapter: SubtitlesProvidersAdapter
  config: Pick<PlatformConfig, "selectors">
  menuBelow?: boolean
}

export async function mountSubtitlesUI({
  adapter,
  config,
  menuBelow,
}: MountSubtitlesUIOptions): Promise<void> {
  const videoContainer = await waitForElement(config.selectors.playerContainer)
  if (!videoContainer) return

  const parentEl = videoContainer as HTMLElement
  const computedStyle = window.getComputedStyle(parentEl)
  if (computedStyle.position === "static") {
    parentEl.style.position = "relative"
  }

  const existingHost = document.getElementById(
    READ_FROG_SUBTITLES_UI_HOST_ID,
  ) as HTMLDivElement | null
  if (existingHost) {
    if (existingHost.parentElement === parentEl) {
      return
    }

    ;(existingHost as any).__reactShadowContainerCleanup?.()
    existingHost.remove()
  }

  const shadowHost = document.createElement("div")
  shadowHost.id = READ_FROG_SUBTITLES_UI_HOST_ID
  shadowHost.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 9999;
    transition: bottom 0.2s ease-out;
    overflow: visible;
  `

  const cleanupUi = mountReactShadowUi({
    cssContent: [themeCSS],
    host: shadowHost,
    style: {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      pointerEvents: "none",
      overflow: "visible",
    },
    target: parentEl,
    theme: SUBTITLES_THEME,
    render: ({ container }) => (
      <ShadowWrapperContext value={container}>
        <SubtitlesProviders adapter={adapter} openBelow={menuBelow}>
          <LocaleBoundary>
            <SubtitlesContainer />
          </LocaleBoundary>
        </SubtitlesProviders>
      </ShadowWrapperContext>
    ),
  })

  const cleanupToast = mountSubtitlesToast()
  ;(shadowHost as any).__reactShadowContainerCleanup = () => {
    cleanupToast()
    cleanupUi()
  }
}
