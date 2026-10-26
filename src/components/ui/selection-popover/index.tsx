"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { IconGripHorizontal, IconPin, IconPinnedFilled, IconX } from "@tabler/icons-react"
import * as React from "react"
import { Button } from "@/components/ui/base-ui/button"
import {
  SELECTION_CONTENT_OVERLAY_LAYERS,
  SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE,
} from "@/entrypoints/selection.content/overlay-layers"
import { NOTRANSLATE_CLASS } from "@/utils/constants/dom-labels"
import { createContextWithHook } from "@/utils/react/context"
import { cn } from "@/utils/styles/utils"
import { clamp } from "@/utils/utils"
import { usePreventScrollThrough } from "./use-prevent-scroll-through"
import {
  SELECTION_POPOVER_DRAG_HANDLE_CLASS,
  SELECTION_POPOVER_NO_DRAG_SELECTOR,
  SELECTION_POPOVER_RESIZE_HANDLE_STYLES,
  useSelectionPopoverLayout,
} from "./use-selection-popover-layout"

interface SelectionPopoverPosition {
  x: number
  y: number
}

interface SelectionPopoverActions {
  requestOpen: (anchor?: SelectionPopoverPosition | null) => void
}

type SelectionPopoverPortalContainer =
  | HTMLElement
  | ShadowRoot
  | React.RefObject<HTMLElement | ShadowRoot | null>
  | null

interface SelectionPopoverRootContextValue {
  open: boolean
  setOpen: (value: boolean | ((value: boolean) => boolean)) => void
  anchor: SelectionPopoverPosition | null
  setAnchor: (value: SelectionPopoverPosition | null) => void
  pinned: boolean
  setPinned: (value: boolean | ((value: boolean) => boolean)) => void
  requestOpen: (anchor?: SelectionPopoverPosition | null) => void
  triggerElement: HTMLElement | null
  setTriggerElement: React.Dispatch<React.SetStateAction<HTMLElement | null>>
}

interface SelectionPopoverContentContextValue {
  close: () => void
  isDragging: boolean
  portalContainer: SelectionPopoverPortalContainer
  setBodyElement: (node: HTMLDivElement | null) => void
}

const { Context: SelectionPopoverRootContext, useRequiredContext: useSelectionPopoverRootContext } =
  createContextWithHook<SelectionPopoverRootContextValue>(
    "SelectionPopover components must be used within SelectionPopover.Root.",
  )
const {
  Context: SelectionPopoverContentContext,
  useRequiredContext: useSelectionPopoverContentContext,
} = createContextWithHook<SelectionPopoverContentContextValue>(
  "SelectionPopover content slots must be used within SelectionPopover.Content.",
)
const SELECTION_POPOVER_OPEN_EVENT = "read-frog:selection-popover-open"

export function useSelectionPopoverOverlayProps() {
  const context = React.use(SelectionPopoverContentContext)

  return {
    container: context?.portalContainer,
    positionerClassName: context ? SELECTION_CONTENT_OVERLAY_LAYERS.popoverOverlay : undefined,
  }
}

function SelectionPopoverRoot({
  anchor: anchorProp,
  children,
  defaultOpen = false,
  defaultPinned = false,
  disablePointerDismissal = false,
  open: openProp,
  pinned: pinnedProp,
  actionsRef,
  onAnchorChange,
  onOpenChange,
  onPinnedChange,
  onReuseRequest,
}: {
  anchor?: SelectionPopoverPosition | null
  children: React.ReactNode
  defaultOpen?: boolean
  defaultPinned?: boolean
  disablePointerDismissal?: boolean
  open?: boolean
  pinned?: boolean
  actionsRef?: React.RefObject<SelectionPopoverActions | null>
  onAnchorChange?: (anchor: SelectionPopoverPosition | null) => void
  onOpenChange?: (open: boolean) => void
  onPinnedChange?: (pinned: boolean) => void
  onReuseRequest?: (details: { anchor: SelectionPopoverPosition | null }) => void
}) {
  const instanceId = React.useId()
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const [uncontrolledAnchor, setUncontrolledAnchor] =
    React.useState<SelectionPopoverPosition | null>(null)
  const [uncontrolledPinned, setUncontrolledPinned] = React.useState(defaultPinned)
  const [triggerElement, setTriggerElement] = React.useState<HTMLElement | null>(null)
  const reopenFrameRef = React.useRef<number | null>(null)
  const open = openProp ?? uncontrolledOpen
  const anchor = anchorProp ?? uncontrolledAnchor
  const pinned = pinnedProp ?? uncontrolledPinned

  const setPinned = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const nextPinned = typeof value === "function" ? value(pinned) : value

      if (pinnedProp === undefined) {
        setUncontrolledPinned(nextPinned)
      }

      onPinnedChange?.(nextPinned)
    },
    [onPinnedChange, pinned, pinnedProp],
  )

  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const nextOpen = typeof value === "function" ? value(open) : value

      if (!nextOpen && pinned) {
        setPinned(false)
      }

      if (openProp === undefined) {
        setUncontrolledOpen(nextOpen)
      }

      onOpenChange?.(nextOpen)
    },
    [onOpenChange, open, openProp, pinned, setPinned],
  )

  const setAnchor = React.useCallback(
    (value: SelectionPopoverPosition | null) => {
      if (anchorProp === undefined) {
        setUncontrolledAnchor(value)
      }

      onAnchorChange?.(value)
    },
    [anchorProp, onAnchorChange],
  )

  const requestOpen = React.useCallback(
    (nextAnchor: SelectionPopoverPosition | null = null) => {
      if (open && pinned) {
        // A pinned popover is reused in place: keep its anchor, layout, and
        // pin state, and let the consumer swap session-scoped content via
        // onReuseRequest. Re-dispatch the open event to re-assert exclusivity.
        window.dispatchEvent(
          new CustomEvent(SELECTION_POPOVER_OPEN_EVENT, {
            detail: { instanceId },
          }),
        )
        onReuseRequest?.({ anchor: nextAnchor })
        return
      }

      if (open) {
        // Reopen on the next frame so controlled consumers observe a full
        // close/open cycle and can refresh session-scoped state from the
        // current selection.
        if (reopenFrameRef.current !== null) {
          cancelAnimationFrame(reopenFrameRef.current)
        }
        setOpen(false)
        reopenFrameRef.current = requestAnimationFrame(() => {
          reopenFrameRef.current = null
          if (nextAnchor) {
            setAnchor(nextAnchor)
          }
          setOpen(true)
        })
        return
      }

      if (nextAnchor) {
        setAnchor(nextAnchor)
      }
      setOpen(true)
    },
    [instanceId, onReuseRequest, open, pinned, setAnchor, setOpen],
  )

  React.useImperativeHandle(actionsRef, () => ({ requestOpen }), [requestOpen])

  React.useEffect(() => {
    return () => {
      if (reopenFrameRef.current !== null) {
        cancelAnimationFrame(reopenFrameRef.current)
      }
    }
  }, [])

  React.useEffect(() => {
    if (!open) {
      return undefined
    }

    const handlePeerPopoverOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ instanceId?: string }>
      if (customEvent.detail?.instanceId && customEvent.detail.instanceId !== instanceId) {
        setOpen(false)
      }
    }

    window.addEventListener(SELECTION_POPOVER_OPEN_EVENT, handlePeerPopoverOpen)
    window.dispatchEvent(
      new CustomEvent(SELECTION_POPOVER_OPEN_EVENT, {
        detail: { instanceId },
      }),
    )

    return () => {
      window.removeEventListener(SELECTION_POPOVER_OPEN_EVENT, handlePeerPopoverOpen)
    }
  }, [instanceId, open, setOpen])

  const contextValue = React.useMemo(
    () => ({
      open,
      setOpen,
      anchor,
      setAnchor,
      pinned,
      setPinned,
      requestOpen,
      triggerElement,
      setTriggerElement,
    }),
    [anchor, open, pinned, requestOpen, setAnchor, setOpen, setPinned, triggerElement],
  )

  return (
    <SelectionPopoverRootContext value={contextValue}>
      <DialogPrimitive.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
        }}
        disablePointerDismissal={pinned || disablePointerDismissal}
        modal={false}
      >
        {children}
      </DialogPrimitive.Root>
    </SelectionPopoverRootContext>
  )
}

function SelectionPopoverTrigger({
  className,
  children,
  render,
  ...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) {
  const { open, requestOpen, setTriggerElement } = useSelectionPopoverRootContext()

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      setTriggerElement(event.currentTarget)
      requestOpen({ x: rect.left, y: rect.top })
    },
    [requestOpen, setTriggerElement],
  )

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        type: "button",
        className: cn(
          "flex h-7 shrink-0 cursor-pointer items-center justify-center px-2 hover:bg-accent",
          className,
        ),
        children,
        onClick: handleClick,
      },
      props,
    ),
    render,
    state: {
      slot: "selection-popover-trigger",
      open,
    },
  })
}

const RESIZE_DIRECTIONS = [
  "top",
  "right",
  "bottom",
  "left",
  "topRight",
  "bottomRight",
  "bottomLeft",
  "topLeft",
] as const

type SelectionPopoverResizeDirection = (typeof RESIZE_DIRECTIONS)[number]

const SELECTION_POPOVER_RESIZE_CURSORS: Record<SelectionPopoverResizeDirection, string> = {
  top: "ns-resize",
  right: "ew-resize",
  bottom: "ns-resize",
  left: "ew-resize",
  topRight: "nesw-resize",
  bottomLeft: "nesw-resize",
  topLeft: "nwse-resize",
  bottomRight: "nwse-resize",
}

type SelectionPopoverShellProps = Omit<
  React.ComponentProps<"div">,
  "onDrag" | "onDragStart" | "ref"
> &
  ReturnType<typeof useSelectionPopoverLayout> & {
    ref?: React.Ref<HTMLDivElement>
  }

function SelectionPopoverShell({
  children,
  className,
  defaultLayout,
  handleDrag,
  handleDragStart,
  handleDragStop,
  handleResizeStop,
  handleWheel,
  isDragging: _isDragging,
  minHeight,
  minWidth,
  position,
  elementRef,
  ref: forwardedRef,
  style,
  ...props
}: SelectionPopoverShellProps) {
  const sizeRef = React.useRef<{ width: number | null; height: number | null }>({
    width: defaultLayout.width,
    height: null,
  })

  const assignElementRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      elementRef.current = node

      if (typeof forwardedRef === "function") {
        forwardedRef(node)
        return
      }

      if (forwardedRef) {
        forwardedRef.current = node
      }
    },
    [forwardedRef, elementRef],
  )

  const handleDragPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }

      const target = event.target as HTMLElement | null
      if (!target?.closest(`.${SELECTION_POPOVER_DRAG_HANDLE_CLASS}`)) {
        return
      }

      if (target.closest(SELECTION_POPOVER_NO_DRAG_SELECTOR)) {
        return
      }

      const element = event.currentTarget
      const rect = element.getBoundingClientRect()
      const pointerStartX = event.clientX
      const pointerStartY = event.clientY
      let nextX = rect.left
      let nextY = rect.top

      handleDragStart()
      element.setPointerCapture(event.pointerId)

      const onPointerMove = (moveEvent: PointerEvent) => {
        nextX = rect.left + (moveEvent.clientX - pointerStartX)
        nextY = rect.top + (moveEvent.clientY - pointerStartY)
        handleDrag({ x: nextX, y: nextY })
      }

      const onPointerEnd = (endEvent: PointerEvent) => {
        element.removeEventListener("pointermove", onPointerMove)
        element.removeEventListener("pointerup", onPointerEnd)
        element.removeEventListener("pointercancel", onPointerEnd)
        if (element.hasPointerCapture(endEvent.pointerId)) {
          element.releasePointerCapture(endEvent.pointerId)
        }
        handleDragStop({ x: nextX, y: nextY })
      }

      element.addEventListener("pointermove", onPointerMove)
      element.addEventListener("pointerup", onPointerEnd)
      element.addEventListener("pointercancel", onPointerEnd)
    },
    [handleDrag, handleDragStart, handleDragStop],
  )

  const handleResizePointerDown = React.useCallback(
    (direction: SelectionPopoverResizeDirection, event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }

      const element = event.currentTarget.parentElement
      if (!element) {
        return
      }

      const rect = element.getBoundingClientRect()
      const startLeft = rect.left
      const startTop = rect.top
      const startRight = rect.right
      const startBottom = rect.bottom
      const maxWidth = window.innerWidth
      const maxHeight = window.innerHeight
      let nextX = startLeft
      let nextY = startTop

      element.setPointerCapture(event.pointerId)

      const onPointerMove = (moveEvent: PointerEvent) => {
        let left = startLeft
        let top = startTop
        let right = startRight
        let bottom = startBottom

        if (direction === "right" || direction.endsWith("Right")) {
          right = clamp(moveEvent.clientX, startLeft + minWidth, maxWidth)
        }
        if (direction === "bottom" || direction.startsWith("bottom")) {
          bottom = clamp(moveEvent.clientY, startTop + minHeight, maxHeight)
        }
        if (direction === "left" || direction.endsWith("Left")) {
          left = clamp(moveEvent.clientX, 0, startRight - minWidth)
        }
        if (direction === "top" || direction.startsWith("top")) {
          top = clamp(moveEvent.clientY, 0, startBottom - minHeight)
        }

        const width = right - left
        const height = bottom - top
        nextX = left
        nextY = top
        sizeRef.current = { width, height }
        element.style.width = `${width}px`
        element.style.height = `${height}px`
        element.style.transform = `translate(${left}px, ${top}px)`
      }

      const onPointerEnd = (endEvent: PointerEvent) => {
        element.removeEventListener("pointermove", onPointerMove)
        element.removeEventListener("pointerup", onPointerEnd)
        element.removeEventListener("pointercancel", onPointerEnd)
        if (element.hasPointerCapture(endEvent.pointerId)) {
          element.releasePointerCapture(endEvent.pointerId)
        }
        handleResizeStop(element, { x: nextX, y: nextY })
      }

      element.addEventListener("pointermove", onPointerMove)
      element.addEventListener("pointerup", onPointerEnd)
      element.addEventListener("pointercancel", onPointerEnd)
    },
    [handleResizeStop, minHeight, minWidth],
  )

  return (
    <div
      ref={assignElementRef}
      {...props}
      onPointerDown={handleDragPointerDown}
      onWheel={handleWheel}
      className={cn(
        `pointer-events-auto flex flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-floating ${NOTRANSLATE_CLASS}`,
        className,
      )}
      {...{ [SELECTION_CONTENT_OVERLAY_ROOT_ATTRIBUTE]: "" }}
      style={{
        display: "flex",
        position: "absolute",
        top: 0,
        left: 0,
        minWidth,
        minHeight,
        width: sizeRef.current.width ?? undefined,
        height: sizeRef.current.height ?? undefined,
        ...style,
        opacity: "var(--rf-selection-opacity, 1)",
        maxWidth: "100vw",
        maxHeight: "100vh",
        transform: `translate(${position.x}px, ${position.y}px)`,
      }}
    >
      {children}
      {RESIZE_DIRECTIONS.map((direction) => (
        <div
          key={direction}
          onPointerDown={(event) => handleResizePointerDown(direction, event)}
          style={{
            position: "absolute",
            zIndex: 100,
            touchAction: "none",
            cursor: SELECTION_POPOVER_RESIZE_CURSORS[direction],
            ...SELECTION_POPOVER_RESIZE_HANDLE_STYLES[direction],
          }}
        />
      ))}
    </div>
  )
}

function SelectionPopoverContent({
  className,
  children,
  container,
  finalFocus,
  render,
  ...props
}: useRender.ComponentProps<"div"> &
  React.ComponentProps<"div"> & {
    container?: SelectionPopoverPortalContainer
    finalFocus?: DialogPrimitive.Popup.Props["finalFocus"]
  }) {
  const { open, setOpen, anchor, triggerElement } = useSelectionPopoverRootContext()
  // Tracked as state (not a ref) so listeners re-attach when Body remounts
  // while the popover stays open, e.g. a pinned popover reused for a new
  // selection session.
  const [bodyElement, setBodyElement] = React.useState<HTMLDivElement | null>(null)

  const {
    elementRef,
    isDragging,
    position,
    defaultLayout,
    minWidth,
    minHeight,
    handleDragStart,
    handleDrag,
    handleDragStop,
    handleResizeStop,
    handleWheel,
  } = useSelectionPopoverLayout({
    anchor,
    isVisible: open,
  })

  const handleClose = React.useCallback(() => {
    setOpen(false)
  }, [setOpen])

  usePreventScrollThrough({
    isEnabled: open,
    element: bodyElement,
  })

  const contentContextValue = React.useMemo(
    () => ({
      close: handleClose,
      isDragging,
      portalContainer: container ?? null,
      setBodyElement,
    }),
    [container, handleClose, isDragging, setBodyElement],
  )

  const shell = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn("flex h-full min-h-0 flex-1 flex-col", className),
        children: (
          <SelectionPopoverContentContext value={contentContextValue}>
            {children}
          </SelectionPopoverContentContext>
        ),
      },
      props,
    ),
    render,
    state: {
      slot: "selection-popover-content",
      open,
      dragging: isDragging,
    },
  })

  if (!anchor) {
    return null
  }

  const resolvedFinalFocus = finalFocus ?? (triggerElement ? { current: triggerElement } : false)

  return (
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Popup
        className={cn(
          "pointer-events-none fixed inset-0 focus:outline-none",
          SELECTION_CONTENT_OVERLAY_LAYERS.popover,
        )}
        finalFocus={resolvedFinalFocus}
      >
        <SelectionPopoverShell
          elementRef={elementRef}
          isDragging={isDragging}
          position={position}
          defaultLayout={defaultLayout}
          minWidth={minWidth}
          minHeight={minHeight}
          handleDragStart={handleDragStart}
          handleDrag={handleDrag}
          handleDragStop={handleDragStop}
          handleResizeStop={handleResizeStop}
          handleWheel={handleWheel}
        >
          {shell}
        </SelectionPopoverShell>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function SelectionPopoverHeader({
  children,
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) {
  const { isDragging } = useSelectionPopoverContentContext()

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          `${SELECTION_POPOVER_DRAG_HANDLE_CLASS} group relative flex items-center justify-between gap-3 px-4 py-2 select-none hover:cursor-grab active:cursor-grabbing`,
          className,
        ),
        children: (
          <>
            <div
              className={cn(
                "absolute top-0 left-1/2 -translate-x-1/2 p-1 transition-all duration-200",
                isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <IconGripHorizontal className="size-4" />
            </div>
            {children}
          </>
        ),
      },
      props,
    ),
    render,
    state: {
      slot: "selection-popover-header",
      dragging: isDragging,
    },
  })
}

function SelectionPopoverBody({
  className,
  render,
  ref: forwardedRef,
  ...props
}: useRender.ComponentProps<"div"> &
  React.ComponentProps<"div"> & {
    ref?: React.Ref<HTMLDivElement>
  }) {
  const { setBodyElement } = useSelectionPopoverContentContext()

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn("min-h-0 flex-1 overflow-y-auto", className),
      },
      props,
    ),
    ref: forwardedRef ? [forwardedRef, setBodyElement] : setBodyElement,
    render,
    state: {
      slot: "selection-popover-body",
    },
  })
}

function SelectionPopoverFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2 px-4 py-2", className)} {...props} />
}

function SelectionPopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />
}

function SelectionPopoverPin({
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { pinned, setPinned } = useSelectionPopoverRootContext()
  const togglePinned = React.useCallback(() => {
    setPinned((prev) => !prev)
  }, [setPinned])
  const label = pinned ? "Unpin popover" : "Pin popover"

  return (
    <Button
      variant="ghost-secondary"
      size="icon-sm"
      className={className}
      onClick={togglePinned}
      aria-label={label}
      aria-pressed={pinned}
      title={label}
      data-rf-no-drag
      {...props}
    >
      {children ?? (
        <>
          {pinned ? <IconPinnedFilled /> : <IconPin />}
          <span className="sr-only">{label}</span>
        </>
      )}
    </Button>
  )
}

function SelectionPopoverClose({
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <DialogPrimitive.Close
      render={
        <Button variant="ghost-secondary" size="icon-sm" className={className} data-rf-no-drag />
      }
      {...props}
    >
      {children ?? (
        <>
          <IconX />
          <span className="sr-only">Close</span>
        </>
      )}
    </DialogPrimitive.Close>
  )
}

const SelectionPopover = {
  Root: SelectionPopoverRoot,
  Trigger: SelectionPopoverTrigger,
  Content: SelectionPopoverContent,
  Header: SelectionPopoverHeader,
  Body: SelectionPopoverBody,
  Footer: SelectionPopoverFooter,
  Title: SelectionPopoverTitle,
  Pin: SelectionPopoverPin,
  Close: SelectionPopoverClose,
} as const

export type { SelectionPopoverActions, SelectionPopoverPosition }

export {
  SelectionPopover,
  SelectionPopoverBody,
  SelectionPopoverClose,
  SelectionPopoverContent,
  SelectionPopoverFooter,
  SelectionPopoverHeader,
  SelectionPopoverPin,
  SelectionPopoverRoot,
  SelectionPopoverTitle,
  SelectionPopoverTrigger,
}
