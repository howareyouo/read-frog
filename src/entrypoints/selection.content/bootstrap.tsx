import { kebabCase } from "case-anything"
import { Provider as JotaiProvider } from "jotai"
import ReactDOM from "react-dom/client"
import type { ContentScriptContext } from "#imports"
import { createShadowRootUi } from "#imports"
import { ConfigHydrateProvider } from "@/components/providers/config-hydrate-provider"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import type { Config } from "@/types/config/config"
import { ComposeProviders } from "@/utils/compose-providers"
import { APP_NAME } from "@/utils/constants/app"
import { initI18n } from "@/utils/i18n"
import { LocaleBoundary } from "@/utils/i18n/locale-boundary"
import { protectSelectAllShadowRoot } from "@/utils/select-all"
import { insertShadowRootUIWrapperInto, OVERLAY_SHADOW_ROOT_CSS } from "@/utils/shadow-root"
import { clearEffectiveSiteControlUrl } from "@/utils/site-control"
import { getLocalThemeMode } from "@/utils/theme"
import App from "./app"
import { setupExternalSelectionSource } from "./external-selection-source"

// eslint-disable-next-line import/no-mutable-exports
export let shadowWrapper: HTMLElement | null = null

async function mountSelectionUI(ctx: ContentScriptContext) {
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
        <ComposeProviders
          providers={[
            (children) => <JotaiProvider>{children}</JotaiProvider>,
            (children) => (
              <ConfigHydrateProvider themeMode={themeMode}>{children}</ConfigHydrateProvider>
            ),
            (children) => <ThemeProvider container={wrapper}>{children}</ThemeProvider>,
            (children) => <TooltipProvider>{children}</TooltipProvider>,
            (children) => <LocaleBoundary>{children}</LocaleBoundary>,
          ]}
        >
          <App uiContainer={container} portalContainer={shadow} />
        </ComposeProviders>,
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
 * Selection UI bootstrap, run by the host.content entrypoint (manifest
 * injection on top frames, programmatic background injection for full-runtime
 * iframes). Double-injection is guarded by the entrypoint's host gate.
 */
export async function bootstrapSelectionContent(ctx: ContentScriptContext, config: Config | null) {
  ctx.onInvalidated(() => {
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
