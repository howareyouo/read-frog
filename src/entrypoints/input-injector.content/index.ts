import { defineContentScript } from "#imports"
import { replaceText } from "./replace-text"

export default defineContentScript({
  matches: ["*://*/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    if ((window as any).__READ_FROG_INPUT_INJECTOR__) return

    ;(window as any).__READ_FROG_INPUT_INJECTOR__ = true

    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== "READ_FROG_INPUT_REPLACE") return

      replaceText(event.data.text)
    })
  },
})
