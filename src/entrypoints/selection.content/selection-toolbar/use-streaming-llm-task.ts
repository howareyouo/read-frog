import { useCallback, useMemo, useRef, useState } from "react"
import type { ThinkingSnapshot } from "@/types/background-stream"
import type { SelectionToolbarErrorKind, SelectionToolbarInlineError } from "./inline-error"
import { createSelectionToolbarRuntimeError, isAbortError } from "./inline-error"

interface StreamingLlmTaskActions {
  allocateRun: () => number
  beginTask: (runId: number) => void
  cancelRun: (runId?: number) => void
  endRun: (runId: number) => void
  failPrecheck: (runId: number, precheckError: SelectionToolbarInlineError) => void
  isCurrentRun: (runId: number) => boolean
  registerAbortController: (abortController: AbortController) => void
  reportFailure: (runId: number, errorKind: SelectionToolbarErrorKind, caughtError: unknown) => void
  resetTask: () => void
  updateThinking: (runId: number, snapshot: ThinkingSnapshot | null) => void
}

/**
 * Shared lifecycle scaffolding for the selection toolbar's streaming LLM tasks
 * (translate button, custom actions): run-id staleness guards, AbortController
 * ownership, the is-running flag, thinking-snapshot transitions, and inline
 * error mapping.
 *
 * Consumers keep their own result state and run-key dedupe — what is streamed
 * and how the result is consumed differ per feature. This hook owns what must
 * stay consistent across a run: only the current run may touch the shared
 * state, and cancelling a run aborts its in-flight request.
 */
export function useStreamingLlmTask() {
  const [isRunning, setIsRunning] = useState(false)
  const [thinking, setThinking] = useState<ThinkingSnapshot | null>(null)
  const [error, setError] = useState<SelectionToolbarInlineError | null>(null)
  const runIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const allocateRun = useCallback(() => {
    runIdRef.current += 1
    return runIdRef.current
  }, [])

  const isCurrentRun = useCallback((runId: number) => runIdRef.current === runId, [])

  const registerAbortController = useCallback((abortController: AbortController) => {
    abortControllerRef.current = abortController
  }, [])

  const cancelRun = useCallback((runId?: number) => {
    if (runId !== undefined && runIdRef.current !== runId) {
      return
    }

    runIdRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  const beginTask = useCallback((runId: number) => {
    if (runIdRef.current !== runId) {
      return
    }

    setIsRunning(true)
    setThinking(null)
    setError(null)
  }, [])

  const updateThinking = useCallback((runId: number, snapshot: ThinkingSnapshot | null) => {
    if (runIdRef.current !== runId) {
      return
    }

    setThinking(snapshot)
  }, [])

  const failPrecheck = useCallback((runId: number, precheckError: SelectionToolbarInlineError) => {
    if (runIdRef.current !== runId) {
      return
    }

    setIsRunning(false)
    setError(precheckError)
  }, [])

  const reportFailure = useCallback(
    (runId: number, errorKind: SelectionToolbarErrorKind, caughtError: unknown) => {
      if (isAbortError(caughtError) || runIdRef.current !== runId) {
        return
      }

      setThinking((prev) => (prev?.text ? { ...prev, status: "complete" } : null))
      setError(createSelectionToolbarRuntimeError(errorKind, caughtError))
    },
    [],
  )

  const endRun = useCallback((runId: number) => {
    if (runIdRef.current !== runId) {
      return
    }

    abortControllerRef.current = null
    setIsRunning(false)
  }, [])

  const resetTask = useCallback(() => {
    setIsRunning(false)
    setThinking(null)
    setError(null)
  }, [])

  const task = useMemo<StreamingLlmTaskActions>(
    () => ({
      allocateRun,
      beginTask,
      cancelRun,
      endRun,
      failPrecheck,
      isCurrentRun,
      registerAbortController,
      reportFailure,
      resetTask,
      updateThinking,
    }),
    [
      allocateRun,
      beginTask,
      cancelRun,
      endRun,
      failPrecheck,
      isCurrentRun,
      registerAbortController,
      reportFailure,
      resetTask,
      updateThinking,
    ],
  )

  return { error, isRunning, task, thinking }
}
