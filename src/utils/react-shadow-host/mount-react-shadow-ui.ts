import type { ReactNode } from "react"
import ReactDOM from "react-dom/client"
import { REACT_SHADOW_HOST_CLASS } from "../constants/dom-labels"
import { applyTheme } from "../theme"
import { ShadowHostBuilder } from "./shadow-host-builder"

interface MountReactShadowUiOptions {
  host: HTMLDivElement
  cssContent?: string[]
  /** Display value applied to both the host and the inner wrapper. */
  position?: "inline" | "block"
  style?: Partial<CSSStyleDeclaration>
  theme?: "light" | "dark"
  inheritStyles?: boolean
  /** Where to attach the host; `null` leaves it unattached for the caller to place. */
  target?: HTMLElement | null
  render: (ui: { container: HTMLElement; shadowRoot: ShadowRoot }) => ReactNode
}

export function mountReactShadowUi({
  cssContent,
  host,
  inheritStyles = false,
  position = "block",
  render,
  style,
  target = document.body ?? document.documentElement,
  theme,
}: MountReactShadowUiOptions): () => void {
  host.classList.add(REACT_SHADOW_HOST_CLASS)
  host.style.display = position

  const shadowRoot = host.attachShadow({ mode: "open" })
  const hostBuilder = new ShadowHostBuilder(shadowRoot, {
    position,
    cssContent,
    inheritStyles,
    style,
  })
  const reactContainer = hostBuilder.build()
  if (theme) applyTheme(reactContainer, theme)

  const root = ReactDOM.createRoot(reactContainer)
  root.render(render({ container: reactContainer, shadowRoot }))

  if (target) target.appendChild(host)

  let cleaned = false

  return () => {
    if (cleaned) return

    cleaned = true
    root.unmount()
    hostBuilder.cleanup()
    host.remove()
  }
}
