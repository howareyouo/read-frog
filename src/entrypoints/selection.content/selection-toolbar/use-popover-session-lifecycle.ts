import { useAtomValue, useSetAtom } from "jotai"
import { useCallback, useRef, useState } from "react"
import type { SelectionPopoverActions } from "@/components/ui/selection-popover"
import type { SelectionSession } from "./atoms"
import { isSelectionToolbarVisibleAtom, selectionSessionAtom } from "./atoms"

export interface PopoverSessionOpenRequest {
  anchor?: { x: number; y: number }
  session: SelectionSession | null
}

interface PopoverSessionLifecycleOptions<TRequest extends PopoverSessionOpenRequest> {
  /**
   * Applies provider-owned fields of the pending request (e.g. an action id)
   * when a session is activated, or null when no request is pending.
   */
  applyPendingRequest?: (request: TRequest | null) => void
  /** Provider-owned reset (e.g. cancel in-flight work) run before open or reuse. */
  resetSessionExtra?: () => void
  /** Provider-owned cleanup run after the popover closes. */
  onClosed?: () => void
}

/**
 * Shared open/close/reuse lifecycle for selection popovers backed by a
 * selection session: tracks the open state, anchor, session key, rerun nonce,
 * and the active session, and owns the pending-open-request handoff so a
 * pinned popover can be reused in place for a new selection.
 */
export function usePopoverSessionLifecycle<TRequest extends PopoverSessionOpenRequest>(
  options: PopoverSessionLifecycleOptions<TRequest> = {},
) {
  const [isOpen, setIsOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const [popoverSessionKey, setPopoverSessionKey] = useState(0)
  const [rerunNonce, setRerunNonce] = useState(0)
  const [activeSession, setActiveSession] = useState<SelectionSession | null>(null)
  const selectionSession = useAtomValue(selectionSessionAtom)
  const setIsSelectionToolbarVisible = useSetAtom(isSelectionToolbarVisibleAtom)
  const pendingOpenRequestRef = useRef<TRequest | null>(null)
  const popoverActionsRef = useRef<SelectionPopoverActions | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const resetPopoverSession = useCallback((resetOptions?: { clearAnchor?: boolean }) => {
    setActiveSession(null)
    if (resetOptions?.clearAnchor) {
      setAnchor(null)
    }
  }, [])

  // Anchor application is owned by SelectionPopover.Root (via requestOpen) so
  // a pinned popover reused in place never moves.
  const commitOpenRequest = useCallback((request: TRequest) => {
    pendingOpenRequestRef.current = request
  }, [])

  const applyPendingSession = useCallback(() => {
    const pendingRequest = pendingOpenRequestRef.current

    setActiveSession(pendingRequest?.session ?? selectionSession)
    optionsRef.current.applyPendingRequest?.(pendingRequest ?? null)
    setIsSelectionToolbarVisible(false)
    pendingOpenRequestRef.current = null
  }, [selectionSession, setIsSelectionToolbarVisible])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      optionsRef.current.resetSessionExtra?.()

      if (nextOpen) {
        setPopoverSessionKey((prev) => prev + 1)
        applyPendingSession()
      } else {
        resetPopoverSession({
          clearAnchor: pendingOpenRequestRef.current === null,
        })
        optionsRef.current.onClosed?.()
      }

      setIsOpen(nextOpen)
    },
    [applyPendingSession, resetPopoverSession],
  )

  // Pinned popovers are reused in place for a new request: the window keeps
  // its position, size, and pin state while the content reruns.
  const handleReuseRequest = useCallback(() => {
    optionsRef.current.resetSessionExtra?.()
    applyPendingSession()
    // Forces a rerun even when the retriggered request resolves to an
    // identical key.
    setRerunNonce((prev) => prev + 1)
  }, [applyPendingSession])

  const requestOpen = useCallback(
    (request: TRequest) => {
      commitOpenRequest(request)
      popoverActionsRef.current?.requestOpen(request.anchor ?? null)
    },
    [commitOpenRequest],
  )

  return {
    activeSession,
    anchor,
    commitOpenRequest,
    handleOpenChange,
    handleReuseRequest,
    isOpen,
    popoverActionsRef,
    popoverSessionKey,
    requestOpen,
    rerunNonce,
    selectionSession,
    setAnchor,
    setRerunNonce,
  }
}
