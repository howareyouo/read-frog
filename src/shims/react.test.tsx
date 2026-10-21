// @vitest-environment jsdom
/**
 * Conformance tests for the React→Preact shim (src/shims/react.ts).
 *
 * The interesting failures are Preact-specific, so these tests also run under
 * the production aliasing via `pnpm test:preact`
 * (vitest.preact.config.ts). Under the default vitest config (real React) they
 * still pass — they assert React 19 semantics — but they cannot reproduce the
 * Preact-only breakage.
 */

import { Tooltip } from "@base-ui/react/tooltip"
import { act as rtlAct } from "@testing-library/react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"

/**
 * A bare function component: no forwardRef, no class. React 19 delivers `ref`
 * to it as a regular prop, and spreading props onto a host element applies it.
 */
function PlainButton(props: React.ComponentProps<"button">) {
  return <button type="button" {...props} />
}

async function flush() {
  // eslint-disable-next-line wait-for-expect
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function mountTooltip(ui: React.ReactElement) {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  root.render(<Tooltip.Root>{ui}</Tooltip.Root>)
  return {
    async unmount() {
      // eslint-disable-next-line wait-for-expect
      await rtlAct(async () => {
        root.unmount()
      })
    },
  }
}

describe("react shim: ref-as-prop on plain function components", () => {
  it("delivers refs attached to plain function components to the host element", async () => {
    const refs: unknown[] = []
    const mounted = mountTooltip(
      <Tooltip.Trigger
        render={
          <PlainButton
            data-testid="trigger"
            ref={(el) => {
              refs.push(el)
            }}
          />
        }
      >
        trigger
      </Tooltip.Trigger>,
    )
    await flush()

    const button = container()?.querySelector("button")
    expect(button).not.toBeNull()
    expect(refs.at(-1)).toBe(button)

    await mounted.unmount()
  })

  it("keeps Base UI hover-close from crashing on registered trigger elements", async () => {
    const mounted = mountTooltip(
      <Tooltip.Trigger render={<PlainButton data-testid="trigger" />}>trigger</Tooltip.Trigger>,
    )
    await flush()

    const button = container()?.querySelector("button")
    expect(button).not.toBeNull()

    // Base UI's hover-close logic walks the store's registered trigger
    // elements and calls `contains` on each. If a component instance got
    // registered instead of the DOM node (the pre-shim-fix behavior), this
    // dispatch throws "TypeError: e.contains is not a function".
    expect(() => {
      button?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }))
    }).not.toThrow()

    await mounted.unmount()
  })
})

function container() {
  return document.body
}
