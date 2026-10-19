import type { ReactNode } from "react"
import ReactDOM from "react-dom/client"
import { REACT_SHADOW_HOST_CLASS } from "../constants/dom-labels"
import { applyTheme } from "../theme"
import { ShadowHostBuilder } from "./shadow-host-builder"

interface MountReactShadowUiOptions {
  host: HTMLDivElement
  cssContent?: string[]
  style?: Partial<CSSStyleDeclaration>
  theme?: "light" | "dark"
  target?: HTMLElement
  render: (ui: { container: HTMLElement; shadowRoot: ShadowRoot }) => ReactNode
}

export function mountReactShadowUi({
  cssContent,
  host,
  render,
  style,
  target = document.body ?? document.documentElement,
  theme,
}: MountReactShadowUiOptions): () => void {
  host.classList.add(REACT_SHADOW_HOST_CLASS)

  const shadowRoot = host.attachShadow({ mode: "open" })
  const hostBuilder = new ShadowHostBuilder(shadowRoot, {
    position: "block",
    cssContent,
    inheritStyles: false,
    style,
  })
  const reactContainer = hostBuilder.build()
  if (theme) applyTheme(reactContainer, theme)

  const root = ReactDOM.createRoot(reactContainer)
  root.render(render({ container: reactContainer, shadowRoot }))

  target.appendChild(host)

  let cleaned = false

  return () => {
    if (cleaned) return

    cleaned = true
    root.unmount()
    hostBuilder.cleanup()
    host.remove()
  }
}
