import themeCSS from "@/assets/styles/subtitles.css?inline"
import { ToastProvider } from "@/components/ui/base-ui/toast"
import { NOTRANSLATE_CLASS } from "@/utils/constants/dom-labels"
import { SUBTITLES_THEME } from "@/utils/constants/subtitles"
import {
  getShadowHostCleanup,
  stashShadowHostCleanup,
} from "@/utils/react-shadow-host/create-shadow-host"
import { mountReactShadowUi } from "@/utils/react-shadow-host/mount-react-shadow-ui"

const SUBTITLES_TOAST_HOST_ID = "read-frog-subtitles-toast-host"

export function mountSubtitlesToast(): () => void {
  const existingHost = document.getElementById(SUBTITLES_TOAST_HOST_ID)
  if (existingHost) {
    return getShadowHostCleanup(existingHost) ?? (() => {})
  }

  const shadowHost = document.createElement("div")
  shadowHost.id = SUBTITLES_TOAST_HOST_ID

  const cleanup = mountReactShadowUi({
    cssContent: [themeCSS],
    host: shadowHost,
    theme: SUBTITLES_THEME,
    render: ({ shadowRoot }) => (
      <div className={NOTRANSLATE_CLASS}>
        <ToastProvider portalProps={{ container: shadowRoot }} />
      </div>
    ),
  })
  stashShadowHostCleanup(shadowHost, cleanup)
  return cleanup
}
