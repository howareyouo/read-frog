import "@/utils/zod-config"
import { defineContentScript } from "#imports"
import { getLocalConfig } from "@/utils/config/storage"
import { initI18n } from "@/utils/i18n"
import { isSelectionRuntimeEnabled } from "@/utils/selection-runtime"
import {
  clearEffectiveSiteControlUrl,
  getEffectiveSiteControlUrl,
  isSiteEnabled,
} from "@/utils/site-control"
import { bootstrapSelectionContent } from "../selection.content/bootstrap"
// Imported in the entrypoint so WXT extracts it as this entrypoint's CSS
// (content-scripts/host.css) for createShadowRootUi to inject into the shadow
// root — cssInjectionMode is "ui".
import "@/assets/styles/theme.css"

declare global {
  interface Window {
    __READ_FROG_HOST_INJECTED__?: boolean
  }
}

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    // Prevent double injection (manifest-based + programmatic injection)
    if (window.__READ_FROG_HOST_INJECTED__) return
    window.__READ_FROG_HOST_INJECTED__ = true

    const config = await getLocalConfig()
    const siteControlUrl = getEffectiveSiteControlUrl(window.location.href)

    if (!isSiteEnabled(siteControlUrl, config)) {
      window.__READ_FROG_HOST_INJECTED__ = false
      clearEffectiveSiteControlUrl()
      return
    }

    await initI18n(config?.uiLanguage)

    // The selection UI runs on top frames (manifest injection) and in iframes
    // the background explicitly flagged as full-runtime; translation-only
    // iframe injections skip it, as the separate selection entrypoint used to.
    if (window === window.top || isSelectionRuntimeEnabled()) {
      void bootstrapSelectionContent(ctx, config)
    }

    const { bootstrapHostContent } = await import("./runtime")
    await bootstrapHostContent(ctx, config)
  },
})
