import themeCSS from "@/assets/styles/theme.css?inline"
import { ToastProvider } from "@/components/ui/base-ui/toast"
import { NOTRANSLATE_CLASS } from "@/utils/constants/dom-labels"
import { LocaleBoundary } from "@/utils/i18n/locale-boundary"
import { mountReactShadowUi } from "@/utils/react-shadow-host/mount-react-shadow-ui"

export function mountHostToast(): () => void {
  const shadowHost = document.createElement("div")
  shadowHost.setAttribute("data-read-frog-host-toast", "")

  return mountReactShadowUi({
    cssContent: [themeCSS],
    host: shadowHost,
    render: ({ shadowRoot }) => (
      <div className={NOTRANSLATE_CLASS}>
        {/*
          This context has no page-level React tree, so LocaleBoundary lives at the toast
          root: it drives setUiLanguage off the config storage watcher (via the
          default store's configAtom.onMount), keeping event-time toast strings — e.g.
          translate-text.ts's toastManager.add(...) — in the current UI language.
        */}
        <LocaleBoundary>
          <ToastProvider portalProps={{ container: shadowRoot }} />
        </LocaleBoundary>
      </div>
    ),
  })
}
