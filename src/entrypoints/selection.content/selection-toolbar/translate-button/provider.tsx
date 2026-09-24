import { LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import type { Hotkey } from "@tanstack/hotkeys"
import { HotkeyManager } from "@tanstack/hotkeys"
import { useAtomValue, useSetAtom } from "jotai"
import type { ReactNode } from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react"
import { toastManager } from "@/components/ui/base-ui/toast"
import { SelectionPopover } from "@/components/ui/selection-popover"
import type { BackgroundTextStreamSnapshot } from "@/types/background-stream"
import type { LLMProviderConfig, ProviderConfig } from "@/types/config/provider"
import { isLLMProviderConfig, isTranslateProviderConfig } from "@/types/config/provider"
import { configFieldsAtomMap, writeConfigAtom } from "@/utils/atoms/config"
import { buildFeatureProviderSelectionPatch } from "@/utils/constants/feature-providers"
import { streamBackgroundText } from "@/utils/content-script/background-stream-client"
import { prepareTranslationText } from "@/utils/host/translate/text-preparation"
import { translateTextCore } from "@/utils/host/translate/translate-text"
import { getLightWebPageContext } from "@/utils/host/translate/webpage-context-light"
import { getOrGenerateWebPageSummary } from "@/utils/host/translate/webpage-summary"
import { onMessage } from "@/utils/message"
import {
  isPageTranslationShortcutEmpty,
  isValidConfiguredPageTranslationShortcut,
} from "@/utils/page-translation-shortcut"
import { getTranslatePromptFromConfig } from "@/utils/prompts/translate"
import { nextFeatureProviderIndex } from "@/utils/providers/feature-provider-resolver"
import { resolveModelId } from "@/utils/providers/model-id"
import { getProviderOptionsWithOverride } from "@/utils/providers/options"
import type { SerializableProviderRef } from "@/utils/providers/provider-ref"
import { getSelectableProvidersForCapability } from "@/utils/providers/provider-registry"
import { getTopLevelReasoning } from "@/utils/providers/reasoning"
import { shadowWrapper } from "../../bootstrap"
import { SelectionToolbarErrorAlert } from "../../components/selection-toolbar-error-alert"
import { SelectionToolbarFooterContent } from "../../components/selection-toolbar-footer-content"
import { SelectionToolbarTitleContent } from "../../components/selection-toolbar-title-content"
import type { SelectionSession, SelectionToolbarTranslateRequestSlice } from "../atoms"
import { selectionToolbarTranslateRequestAtom } from "../atoms"
import { createSelectionToolbarPrecheckError } from "../inline-error"
import { usePopoverSessionLifecycle } from "../use-popover-session-lifecycle"
import { useSelectionOpenRequestResolver } from "../use-selection-open-request"
import { useStreamingLlmTask } from "../use-streaming-llm-task"
import { TargetLanguageSelector } from "./target-language-selector"
import { TranslationContent } from "./translation-content"

interface SelectionTranslatePendingOpenRequest {
  anchor?: { x: number; y: number }
  session: SelectionSession
}

/**
 * Page context for the selection prompt. `summaryProviderRef` is the provider
 * the (cached, smart-context-gated) page summary runs on; pass null to skip
 * the summary while keeping the raw context (pure translate providers).
 */
async function getSelectionWebPagePromptContext(
  summaryProviderRef: SerializableProviderRef | null,
  enableAIContentAware: boolean,
) {
  const webPageContext = await getLightWebPageContext()
  if (!webPageContext) {
    return undefined
  }

  const webSummary = summaryProviderRef
    ? await getOrGenerateWebPageSummary(webPageContext, summaryProviderRef, enableAIContentAware)
    : null
  return {
    webTitle: webPageContext.webTitle,
    webDescription: webPageContext.webDescription,
    webContent: webPageContext.webContent,
    webSummary: webSummary ?? undefined,
  }
}

async function translateWithTextStream({
  preparedText,
  providerId,
  providerConfig,
  translateRequest,
  onChunk,
  registerAbortController,
}: {
  preparedText: string
  providerId: string
  providerConfig: LLMProviderConfig
  translateRequest: SelectionToolbarTranslateRequestSlice
  onChunk: (data: BackgroundTextStreamSnapshot) => void
  registerAbortController: (abortController: AbortController) => void
}) {
  const targetLangName = LANG_CODE_TO_EN_NAME[translateRequest.language.targetCode]
  const modelName = resolveModelId(providerConfig.model)
  const reasoning = getTopLevelReasoning(providerConfig)
  const providerOptions = getProviderOptionsWithOverride(
    modelName ?? "",
    providerConfig.provider,
    providerConfig.providerOptions,
    reasoning,
  )
  const temperature = providerConfig.temperature
  const abortController = new AbortController()
  registerAbortController(abortController)

  const throwIfAborted = () => {
    if (abortController.signal.aborted) {
      throw new DOMException("aborted", "AbortError")
    }
  }

  const webPageContext = await getSelectionWebPagePromptContext(
    { kind: "local", config: providerConfig },
    translateRequest.enableAIContentAware,
  )
  throwIfAborted()

  const { systemPrompt, prompt } = getTranslatePromptFromConfig(
    { customPromptsConfig: translateRequest.customPromptsConfig },
    targetLangName,
    preparedText,
    {
      ...(webPageContext
        ? {
            context: {
              webTitle: webPageContext.webTitle,
              webDescription: webPageContext.webDescription,
              webContent: webPageContext.webContent,
              webSummary: webPageContext.webSummary,
            },
          }
        : {}),
    },
  )

  const translatedText = await streamBackgroundText(
    {
      providerId,
      instructions: systemPrompt,
      prompt,
      providerOptions,
      reasoning,
      temperature,
    },
    {
      signal: abortController.signal,
      onChunk,
    },
  )

  return translatedText
}

async function translateWithStandardProvider({
  text,
  providerConfig,
  translateRequest,
}: {
  text: string
  providerConfig: ProviderConfig
  translateRequest: SelectionToolbarTranslateRequestSlice
}) {
  // This path is reached only for pure translate providers, and those take no
  // prompt — requesting a summary for them was a doomed queue task that could
  // never generate text.
  const webPageContext = await getSelectionWebPagePromptContext(
    null,
    translateRequest.enableAIContentAware,
  )
  const translatedText = await translateTextCore({
    text,
    langConfig: translateRequest.language,
    providerConfig,
    enableAIContentAware: translateRequest.enableAIContentAware,
    extraHashTags: ["selectionTranslation"],
    webPageContext,
  })

  return translatedText
}

interface SelectionTranslationContextValue {
  prepareToolbarOpen: () => void
}

const SelectionTranslationContext = createContext<SelectionTranslationContextValue | null>(null)

function useSelectionTranslationContext() {
  const context = useContext(SelectionTranslationContext)
  if (!context) {
    throw new Error(
      "Selection translation popover must be used within SelectionTranslationProvider.",
    )
  }

  return context
}

export function useSelectionTranslationPopover() {
  return useSelectionTranslationContext()
}

export function SelectionTranslationProvider({ children }: { children: ReactNode }) {
  const [translatedText, setTranslatedText] = useState<string | undefined>(undefined)
  const { error, isRunning: isTranslating, task, thinking } = useStreamingLlmTask()
  const translateRequest = useAtomValue(selectionToolbarTranslateRequestAtom)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)
  const selectionToolbar = useAtomValue(configFieldsAtomMap.selectionToolbar)
  const setConfig = useSetAtom(writeConfigAtom)
  const lastTranslationRunKeyRef = useRef<string | null>(null)

  const resetTranslationState = useCallback(() => {
    task.resetTask()
    setTranslatedText(undefined)
  }, [task])

  const {
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
  } = usePopoverSessionLifecycle<SelectionTranslatePendingOpenRequest>({
    onClosed: () => {
      lastTranslationRunKeyRef.current = null
    },
    resetSessionExtra: () => {
      task.cancelRun()
      resetTranslationState()
    },
  })

  const { resolveContextMenuOpenRequest, resolveShortcutOpenRequest } =
    useSelectionOpenRequestResolver(selectionSession)
  const selectionText = activeSession?.selectionSnapshot.text ?? null
  const paragraphsText = activeSession?.contextSnapshot.text ?? selectionText
  const titleText = document.title || null
  const translateProviders = useMemo(
    () => getSelectableProvidersForCapability("selectionTranslation", providersConfig),
    [providersConfig],
  )
  const translateRequestKey = useMemo(() => JSON.stringify(translateRequest), [translateRequest])

  const handleProviderChange = useCallback(
    (providerId: string) => {
      void setConfig(buildFeatureProviderSelectionPatch("selectionTranslation", providerId))
    },
    [setConfig],
  )

  const handleRegenerate = useCallback(() => {
    task.cancelRun()
    setRerunNonce((prev) => prev + 1)
  }, [setRerunNonce, task])

  const runTranslation = useCallback(
    async (runId: number) => {
      const preparedText = prepareTranslationText(selectionText)

      if (preparedText === "") {
        if (task.isCurrentRun(runId)) {
          resetTranslationState()
        }
        return
      }

      task.beginTask(runId)
      setTranslatedText(undefined)

      // Round-robin across the feature's selected providers: pick the next
      // usable (enabled, capability-matching) one for this run.
      const usableProviders = translateRequest.providers.filter(
        (candidate) => candidate.config.enabled && isTranslateProviderConfig(candidate.config),
      )
      const providerIndex = nextFeatureProviderIndex("selectionTranslation", usableProviders.length)
      const provider = providerIndex >= 0 ? usableProviders[providerIndex] : undefined
      if (!provider) {
        if (task.isCurrentRun(runId)) {
          task.failPrecheck(
            runId,
            createSelectionToolbarPrecheckError("translate", "providerUnavailable"),
          )
        }
        return
      }

      try {
        let nextTranslatedText = ""
        if (!isTranslateProviderConfig(provider.config)) {
          if (task.isCurrentRun(runId)) {
            task.failPrecheck(
              runId,
              createSelectionToolbarPrecheckError("translate", "providerUnavailable"),
            )
          }
          return
        } else if (isLLMProviderConfig(provider.config)) {
          const providerConfig = provider.config
          task.updateThinking(runId, { status: "thinking", text: "" })

          const nextSnapshot = await translateWithTextStream({
            preparedText,
            providerId: providerConfig.id,
            providerConfig,
            translateRequest,
            onChunk: (data) => {
              if (task.isCurrentRun(runId)) {
                setTranslatedText(data.output)
                task.updateThinking(runId, data.thinking)
              }
            },
            registerAbortController: task.registerAbortController,
          })

          nextTranslatedText = nextSnapshot.output
          task.updateThinking(runId, nextSnapshot.thinking)
        } else {
          task.updateThinking(runId, null)
          nextTranslatedText = await translateWithStandardProvider({
            text: preparedText,
            providerConfig: provider.config,
            translateRequest,
          })
        }

        if (task.isCurrentRun(runId)) {
          setTranslatedText(nextTranslatedText)
        }
      } catch (caughtError) {
        task.reportFailure(runId, "translate", caughtError)
      } finally {
        task.endRun(runId)
      }
    },
    [resetTranslationState, selectionText, task, translateRequest],
  )

  const startTranslation = useEffectEvent((runId: number) => {
    void runTranslation(runId)
  })

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const nextRunKey = JSON.stringify({
      popoverSessionKey,
      rerunNonce,
      sessionId: activeSession?.id ?? null,
      translateRequestKey,
    })
    if (lastTranslationRunKeyRef.current === nextRunKey) {
      return undefined
    }
    lastTranslationRunKeyRef.current = nextRunKey

    const runId = task.allocateRun()

    startTranslation(runId)

    return () => {
      task.cancelRun(runId)
    }
  }, [activeSession?.id, isOpen, popoverSessionKey, rerunNonce, task, translateRequestKey])

  const prepareToolbarOpen = useCallback(() => {
    if (!selectionSession) {
      return
    }

    commitOpenRequest({
      session: selectionSession,
    })
  }, [commitOpenRequest, selectionSession])

  const resolveContextMenuRequest = useCallback((): SelectionTranslatePendingOpenRequest | null => {
    const request = resolveContextMenuOpenRequest()
    if (!request) {
      return null
    }

    return {
      anchor: request.anchor,
      session: request.session,
    }
  }, [resolveContextMenuOpenRequest])

  const resolveShortcutRequest = useCallback((): SelectionTranslatePendingOpenRequest | null => {
    const request = resolveShortcutOpenRequest()
    if (!request) {
      return null
    }

    return {
      anchor: request.anchor,
      session: request.session,
    }
  }, [resolveShortcutOpenRequest])

  const openSelectionTranslationRequest = useCallback(
    (
      request: SelectionTranslatePendingOpenRequest | null,
      options?: { showMissingSelectionToast?: boolean },
    ) => {
      if (!request) {
        if (options?.showMissingSelectionToast) {
          const nextError = createSelectionToolbarPrecheckError("translate", "missingSelection")
          toastManager.add({ type: "error", title: nextError.description })
        }
        return
      }

      requestOpen(request)
    },
    [requestOpen],
  )

  const openFromContextMenu = useCallback(() => {
    openSelectionTranslationRequest(resolveContextMenuRequest(), {
      showMissingSelectionToast: true,
    })
  }, [openSelectionTranslationRequest, resolveContextMenuRequest])

  const openFromShortcut = useCallback(() => {
    openSelectionTranslationRequest(resolveShortcutRequest())
  }, [openSelectionTranslationRequest, resolveShortcutRequest])

  useEffect(() => {
    const shortcut = selectionToolbar.features.translate.shortcut
    if (
      isPageTranslationShortcutEmpty(shortcut) ||
      !isValidConfiguredPageTranslationShortcut(shortcut)
    ) {
      return undefined
    }

    const registration = HotkeyManager.getInstance().register(
      shortcut as Hotkey,
      () => {
        openFromShortcut()
      },
      {
        ignoreInputs: true,
        preventDefault: true,
        stopPropagation: true,
      },
    )

    return () => {
      registration.unregister()
    }
  }, [openFromShortcut, selectionToolbar.features.translate.shortcut])

  useEffect(() => {
    return onMessage("openSelectionTranslationFromContextMenu", () => {
      openFromContextMenu()
    })
  }, [openFromContextMenu])

  const contextValue = useMemo<SelectionTranslationContextValue>(
    () => ({
      prepareToolbarOpen,
    }),
    [prepareToolbarOpen],
  )

  return (
    <SelectionTranslationContext value={contextValue}>
      <SelectionPopover.Root
        open={isOpen}
        onOpenChange={handleOpenChange}
        anchor={anchor}
        onAnchorChange={setAnchor}
        actionsRef={popoverActionsRef}
        onReuseRequest={handleReuseRequest}
      >
        {children}
        <SelectionPopover.Content
          key={popoverSessionKey}
          container={shadowWrapper ?? document.body}
          finalFocus={false}
        >
          <SelectionPopover.Header className="border-b">
            <SelectionToolbarTitleContent title="Translation" icon="ri:translate" />
            <div className="flex items-center gap-1">
              <TargetLanguageSelector />
              <SelectionPopover.Pin />
              <SelectionPopover.Close />
            </div>
          </SelectionPopover.Header>

          <SelectionPopover.Body key={`${popoverSessionKey}:${activeSession?.id ?? 0}`}>
            <TranslationContent
              selectionContent={selectionText}
              translatedText={translatedText}
              isTranslating={isTranslating}
              thinking={thinking}
            />
            <SelectionToolbarErrorAlert error={error} className="-mt-3" />
          </SelectionPopover.Body>
          <SelectionToolbarFooterContent
            paragraphsText={paragraphsText}
            providers={translateProviders}
            titleText={titleText}
            value={translateRequest.provider?.id ?? ""}
            onProviderChange={handleProviderChange}
            onRegenerate={handleRegenerate}
          />
        </SelectionPopover.Content>
      </SelectionPopover.Root>
    </SelectionTranslationContext>
  )
}
