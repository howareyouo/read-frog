import type { RefObject } from "react"
import { useEffect } from "react"

interface ViewportEventOptions {
  /** Extra scroll targets (e.g. scrollable selection containers), read on enable. */
  extraScrollTargets?: RefObject<Array<EventTarget>>
  /** Element whose size changes also trigger the update, read on enable. */
  observedElement?: RefObject<HTMLElement | null>
}

/**
 * Re-run `onUpdate` (rAF-coalesced) while `enabled`, on every viewport change:
 * captured document scroll, window scroll/resize, visualViewport scroll/resize,
 * the extra scroll targets, and size changes of the observed element. Used to
 * keep floating UI pinned to its anchor as the page moves under it.
 */
export function useViewportChangeEvents(
  enabled: boolean,
  onUpdate: () => void,
  { extraScrollTargets, observedElement }: ViewportEventOptions = {},
) {
  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    let animationFrameId: number | null = null
    const scheduleUpdate = () => {
      if (animationFrameId !== null) {
        return
      }

      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = null
        onUpdate()
      })
    }

    const captureScrollOptions: AddEventListenerOptions = { capture: true, passive: true }
    const passiveOptions: AddEventListenerOptions = { passive: true }
    const scrollTargets = extraScrollTargets?.current ?? []
    const visualViewport = window.visualViewport
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate)

    document.addEventListener("scroll", scheduleUpdate, captureScrollOptions)
    window.addEventListener("scroll", scheduleUpdate, passiveOptions)
    window.addEventListener("resize", scheduleUpdate)
    visualViewport?.addEventListener("scroll", scheduleUpdate, passiveOptions)
    visualViewport?.addEventListener("resize", scheduleUpdate)
    scrollTargets.forEach((target) =>
      target.addEventListener("scroll", scheduleUpdate, captureScrollOptions),
    )
    const observed = observedElement?.current
    if (observed) {
      resizeObserver?.observe(observed)
    }

    return () => {
      document.removeEventListener("scroll", scheduleUpdate, true)
      window.removeEventListener("scroll", scheduleUpdate)
      window.removeEventListener("resize", scheduleUpdate)
      visualViewport?.removeEventListener("scroll", scheduleUpdate)
      visualViewport?.removeEventListener("resize", scheduleUpdate)
      scrollTargets.forEach((target) => target.removeEventListener("scroll", scheduleUpdate, true))
      resizeObserver?.disconnect()
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
    }
  }, [enabled, onUpdate, extraScrollTargets, observedElement])
}
