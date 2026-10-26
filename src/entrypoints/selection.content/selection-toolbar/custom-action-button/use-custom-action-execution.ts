import { LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import type { JSONValue } from "ai"
import type { RefObject } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { BackgroundStructuredObjectStreamSnapshot } from "@/types/background-stream"
import type { AISDKReasoning } from "@/types/config/provider"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { streamBackgroundStructuredObject } from "@/utils/content-script/background-stream-client"
import type { CachedWebPageContext } from "@/utils/host/translate/webpage-context"
import { getLightWebPageContext } from "@/utils/host/translate/webpage-context"
import { buildLocalGenerateTextParams } from "@/utils/providers/generate-params"
import type { CustomActionProviderRef } from "@/utils/providers/provider-registry"
import { truncateContextTextForCustomAction } from "../../utils"
import type { SelectionToolbarCustomActionRequestSlice } from "../atoms"
import {
  buildSelectionToolbarCustomActionSystemPrompt,
  replaceSelectionToolbarCustomActionPromptTokens,
} from "../custom-action-prompt"
import type { SelectionToolbarInlineError } from "../inline-error"
import { createSelectionToolbarPrecheckError } from "../inline-error"
import { useStreamingLlmTask } from "../use-streaming-llm-task"

export interface CustomActionExecutionContext {
  action: SelectionToolbarCustomAction
  provider: CustomActionProviderRef
  promptTokens: {
    selection: string
    paragraphs: string
    targetLanguage: string
    webTitle: string
    webContent: string
  }
}

interface CustomActionExecutionPlan {
  error: SelectionToolbarInlineError | null
  executionContext: CustomActionExecutionContext | null
}

interface ResolvedWebPageContext {
  popoverSessionKey: number
  value: CachedWebPageContext | null
}

interface CustomActionExecutionRequest {
  key: string
  payload: {
    outputSchema: Array<{
      name: string
      type: SelectionToolbarCustomAction["outputSchema"][number]["type"]
    }>
    prompt: string
    providerId: string
    providerOptions?: Record<string, Record<string, JSONValue>>
    reasoning?: AISDKReasoning
    instructions: string
    temperature?: number
  }
}

const FOLLOW_STREAM_BOTTOM_THRESHOLD = 8

function scrollSelectionPopoverBodyToBottom(ref: RefObject<HTMLDivElement | null>) {
  const node = ref.current
  if (!node) {
    return
  }

  // Measured before the chunk renders: a reader who scrolled up to reread
  // earlier output must not be yanked back down, and measuring after the
  // append would misread "was at the bottom" as "far from it" whenever a
  // chunk adds more height than the threshold.
  const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight
  if (distanceToBottom > FOLLOW_STREAM_BOTTOM_THRESHOLD) {
    return
  }

  requestAnimationFrame(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  })
}

function normalizeExecutionKeyValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeExecutionKeyValue)
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nestedValue]) => [key, normalizeExecutionKeyValue(nestedValue)]),
    )
  }

  return value
}

function stringifyExecutionRequestKey(value: Record<string, unknown>) {
  return JSON.stringify(normalizeExecutionKeyValue(value))
}

export function buildCustomActionExecutionPlan(
  customActionRequest: SelectionToolbarCustomActionRequestSlice,
  cleanSelection: string,
  contextText: string,
  webPageContext?: CachedWebPageContext | null,
): CustomActionExecutionPlan {
  const action = customActionRequest.action

  if (!action) {
    return {
      error: createSelectionToolbarPrecheckError("customAction", "actionUnavailable"),
      executionContext: null,
    }
  }

  if (!cleanSelection) {
    return {
      error: createSelectionToolbarPrecheckError("customAction", "missingSelection"),
      executionContext: null,
    }
  }

  const provider = customActionRequest.provider
  if (!provider) {
    return {
      error: createSelectionToolbarPrecheckError("customAction", "providerUnavailable"),
      executionContext: null,
    }
  }

  if (!provider.config.enabled) {
    return {
      error: createSelectionToolbarPrecheckError("customAction", "providerDisabled"),
      executionContext: null,
    }
  }

  if (webPageContext === undefined) {
    return {
      error: null,
      executionContext: null,
    }
  }

  return {
    error: null,
    executionContext: {
      action,
      provider,
      promptTokens: {
        selection: cleanSelection,
        paragraphs: truncateContextTextForCustomAction(contextText || cleanSelection),
        targetLanguage: LANG_CODE_TO_EN_NAME[customActionRequest.language.targetCode],
        webTitle: webPageContext?.webTitle ?? document.title,
        webContent: webPageContext?.webContent || "",
      },
    },
  }
}

export function useCustomActionWebPageContext(open: boolean, popoverSessionKey: number) {
  const [resolvedWebPageContext, setResolvedWebPageContext] =
    useState<ResolvedWebPageContext | null>(null)

  useEffect(() => {
    if (!open) {
      return undefined
    }

    let isCancelled = false

    void getLightWebPageContext()
      .then((nextContext) => {
        if (!isCancelled) {
          setResolvedWebPageContext({
            popoverSessionKey,
            value: nextContext,
          })
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setResolvedWebPageContext({
            popoverSessionKey,
            value: null,
          })
        }
      })

    return () => {
      isCancelled = true
    }
  }, [open, popoverSessionKey])

  if (!open || resolvedWebPageContext?.popoverSessionKey !== popoverSessionKey) {
    return undefined
  }

  return resolvedWebPageContext.value
}

function buildCustomActionExecutionRequest({
  executionContext,
  popoverSessionKey,
  rerunNonce,
}: {
  executionContext: CustomActionExecutionContext
  popoverSessionKey: number
  rerunNonce: number
}): CustomActionExecutionRequest {
  const { action, provider, promptTokens } = executionContext
  const systemPrompt = buildSelectionToolbarCustomActionSystemPrompt(
    action.systemPrompt,
    promptTokens,
    action.outputSchema,
  )
  const prompt = replaceSelectionToolbarCustomActionPromptTokens(action.prompt, promptTokens)
  const outputSchema = action.outputSchema.map(({ name, type }) => ({ name, type }))
  const providerKey = provider.config.provider
  const model = provider.config.model
  const { reasoning, temperature, providerOptions } = buildLocalGenerateTextParams(provider.config)

  return {
    key: stringifyExecutionRequestKey({
      actionId: action.id,
      model,
      outputSchema: action.outputSchema.map(({ description, name, type }) => ({
        description,
        name,
        type,
      })),
      popoverSessionKey,
      prompt,
      promptTokens,
      provider: providerKey,
      providerId: provider.id,
      providerOptions,
      reasoning,
      rerunNonce,
      instructions: systemPrompt,
      temperature,
    }),
    payload: {
      providerId: provider.id,
      instructions: systemPrompt,
      prompt,
      outputSchema,
      providerOptions,
      reasoning,
      temperature,
    },
  }
}

export function useCustomActionExecution({
  bodyRef,
  executionContext,
  open,
  popoverSessionKey,
  rerunNonce,
}: {
  bodyRef: RefObject<HTMLDivElement | null>
  executionContext: CustomActionExecutionContext | null
  open: boolean
  popoverSessionKey: number
  rerunNonce: number
}) {
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const { error, isRunning, task, thinking } = useStreamingLlmTask()
  const lastRunKeyRef = useRef<string | null>(null)
  const bodyRefRef = useRef(bodyRef)
  bodyRefRef.current = bodyRef
  const executionRequest = executionContext
    ? buildCustomActionExecutionRequest({
        executionContext,
        popoverSessionKey,
        rerunNonce,
      })
    : null
  const executionRequestRef = useRef<CustomActionExecutionRequest | null>(null)
  executionRequestRef.current = executionRequest
  const executionRequestKey = executionRequest?.key ?? null

  const resetSessionState = useCallback(() => {
    task.resetTask()
    setResult(null)
  }, [task])

  useEffect(() => {
    if (!open || !executionRequestKey) {
      return undefined
    }

    const request = executionRequestRef.current
    if (!request || request.key !== executionRequestKey) {
      return undefined
    }

    if (lastRunKeyRef.current === executionRequestKey) {
      return undefined
    }
    lastRunKeyRef.current = executionRequestKey

    const runId = task.allocateRun()
    const abortController = new AbortController()
    task.registerAbortController(abortController)

    const run = async () => {
      task.beginTask(runId)
      task.updateThinking(runId, { status: "thinking", text: "" })
      setResult(null)

      try {
        const finalResult = await streamBackgroundStructuredObject(request.payload, {
          signal: abortController.signal,
          onChunk: (partial: BackgroundStructuredObjectStreamSnapshot) => {
            if (!task.isCurrentRun(runId)) {
              return
            }

            setResult(partial.output)
            task.updateThinking(runId, partial.thinking)
            scrollSelectionPopoverBodyToBottom(bodyRefRef.current)
          },
        })

        if (!task.isCurrentRun(runId)) {
          return
        }

        setResult(finalResult.output)
        task.updateThinking(runId, finalResult.thinking)
      } catch (caughtError) {
        task.reportFailure(runId, "customAction", caughtError)
      } finally {
        task.endRun(runId)
      }
    }

    void run()

    return () => {
      task.cancelRun(runId)
    }
  }, [executionRequestKey, open, task])

  useEffect(() => {
    if (!open) {
      lastRunKeyRef.current = null
    }
  }, [open])

  return {
    error,
    isRunning,
    resetSessionState,
    result,
    thinking,
  }
}
