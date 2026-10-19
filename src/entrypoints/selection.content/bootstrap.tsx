import { QueryClientProvider } from "@tanstack/react-query"
import { kebabCase } from "case-anything"
import { Provider as JotaiProvider } from "jotai"
import ReactDOM from "react-dom/client"
import type { ContentScriptContext } from "#imports"
import { createShadowRootUi } from "#imports"
import { ConfigHydrateProvider } from "@/components/providers/config-hydrate-provider"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import type { Config } from "@/types/config/config"
import { APP_NAME } from "@/utils/constants/app"
import { initI18n } from "@/utils/i18n"
import { LocaleBoundary } from "@/utils/i18n/locale-boundary"
import { ensureIconifyBackgroundFetch } from "@/utils/iconify/setup-background-fetch"
import { protectSelectAllShadowRoot } from "@/utils/select-all"
import { insertShadowRootUIWrapperInto, OVERLAY_SHADOW_ROOT_CSS } from "@/utils/shadow-root"
import { clearEffectiveSiteControlUrl } from "@/utils/site-control"
import { queryClient } from "@/utils/tanstack-query"
import { getLocalThemeMode } from "@/utils/theme"
import App from "./app"
import { setupExternalSelectionSource } from "./external-selection-source"

// eslint-disable-next-line import/no-mutable-exports
export let shadowWrapper: HTMLElement | null = null

declare global {
  interface Window {
    __READ_FROG_SELECTION_INJECTED__?: boolean
  }
}

async function mountSelectionUI(ctx: ContentScriptContext) {
  ensureIconifyBackgroundFetch()

  const themeMode = await getLocalThemeMode()

  const ui = await createShadowRootUi(ctx, {
    name: `${kebabCase(APP_NAME)}-selection`,
    position: "overlay",
    anchor: "body",
    css: OVERLAY_SHADOW_ROOT_CSS,
    onMount: (container, shadow, shadowHost) => {
      const wrapper = insertShadowRootUIWrapperInto(container, shadowHost)
      shadowWrapper = wrapper
      protectSelectAllShadowRoot(shadowHost, wrapper)

      const root = ReactDOM.createRoot(wrapper)
      root.render(
        <QueryClientProvider client={queryClient}>
          <JotaiProvider>
            <ConfigHydrateProvider themeMode={themeMode}>
              <ThemeProvider container={wrapper}>
                <TooltipProvider>
                  <LocaleBoundary>
                    <App uiContainer={container} portalContainer={shadow} />
                  </LocaleBoundary>
                </TooltipProvider>
              </ThemeProvider>
            </ConfigHydrateProvider>
          </JotaiProvider>
        </QueryClientProvider>,
      )
      return root
    },
    onRemove: (root) => {
      root?.unmount()
      shadowWrapper = null
    },
  })

  ui.mount()
}

/**
 * Selection UI bootstrap, run by the selection.content entrypoint (manifest
 * injection on top frames, programmatic background injection for full-runtime
 * iframes). The double-injection guard lives in the entrypoint's gate.
 */
export async function bootstrapSelectionContent(ctx: ContentScriptContext, config: Config | null) {
  ctx.onInvalidated(() => {
    window.__READ_FROG_SELECTION_INJECTED__ = false
    clearEffectiveSiteControlUrl()
  })

  // Answer ebook bridge handshakes before the React UI finishes mounting
  const cleanupExternalSelectionSource = setupExternalSelectionSource()
  if (cleanupExternalSelectionSource) {
    ctx.onInvalidated(cleanupExternalSelectionSource)
  }

  await initI18n(config?.uiLanguage)

  void mountSelectionUI(ctx)
}
