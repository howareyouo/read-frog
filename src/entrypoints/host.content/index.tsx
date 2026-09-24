import "@/utils/zod-config"
import { defineContentScript } from "#imports"
import { passContentScriptGate } from "@/utils/content-entry"
import { initI18n } from "@/utils/i18n"
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
    const gate = await passContentScriptGate("__READ_FROG_HOST_INJECTED__")
    if (!gate) return

    await initI18n(gate.config?.uiLanguage)

    const { bootstrapHostContent } = await import("./runtime")
    await bootstrapHostContent(ctx, gate.config)
  },
})
