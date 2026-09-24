import "@/utils/zod-config"
import { defineContentScript } from "#imports"
import { passContentScriptGate } from "@/utils/content-entry"
// Imported in the entrypoint so WXT extracts it as this entrypoint's CSS
// (content-scripts/selection.css) for createShadowRootUi to inject into the
// shadow root — cssInjectionMode is "ui".
import "@/assets/styles/theme.css"
import { bootstrapSelectionContent } from "./bootstrap"

declare global {
  interface Window {
    __READ_FROG_SELECTION_INJECTED__?: boolean
  }
}

export default defineContentScript({
  matches: ["*://*/*", "file:///*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    // Manifest injection runs on top frames only (allFrames is not set).
    // Iframes with the full runtime get this file injected programmatically by
    // the background; translation-only iframe injections skip it.
    const gate = await passContentScriptGate("__READ_FROG_SELECTION_INJECTED__")
    if (!gate) return

    void bootstrapSelectionContent(ctx, gate.config)
  },
})
