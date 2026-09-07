import type { LangCodeISO6393 } from "@read-frog/definitions"
import { defineExtensionMessaging } from "@webext-core/messaging"
import type {
  BackgroundGenerateTextPayload,
  BackgroundGenerateTextResponse,
} from "@/types/background-generate-text"
import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { TranslationTextFormat } from "@/types/config/translate"
import type { ProxyRequest, ProxyResponse } from "@/types/proxy-fetch"
import type { SerializableProviderRef } from "@/utils/providers/provider-ref"

interface ProtocolMap {
  // navigation
  openPage: (data: { url: string; active?: boolean }) => void
  openOptionsPage: (data?: { route?: `/${string}` }) => void
  // config
  getInitialConfig: () => Config | null
  // translation state
  getEnablePageTranslationByTabId: (data: { tabId: number }) => boolean | undefined
  getEnablePageTranslationFromContentScript: () => Promise<boolean>
  tryToSetEnablePageTranslationByTabId: (data: { tabId: number; enabled: boolean }) => void
  setAndNotifyPageTranslationStateChangedByManager: (data: {
    enabled: boolean
    url?: string
    userInitiated?: boolean
  }) => void
  notifyTranslationStateChanged: (data: { enabled: boolean }) => void
  ensureIframeHostContentInjected: (data: { tabId?: number }) => void
  injectCurrentIframesAfterTopFrameNodeTranslation: () => void
  reportDetectedPageLanguage: (data: {
    detectedCodeOrUnd: LangCodeISO6393 | "und"
    url: string
  }) => void
  refreshDetectedPageLanguage: () => void
  getDetectedCode: () => LangCodeISO6393
  detectedPageLanguageChanged: (data: { detectedCode: LangCodeISO6393 }) => void
  // ask host to start page translation
  askManagerToTogglePageTranslation: (data: { enabled: boolean }) => void
  openSelectionTranslationFromContextMenu: (data: { selectionText: string }) => void
  openSelectionCustomActionFromContextMenu: (data: {
    actionId: string
    selectionText: string
  }) => void
  // request
  enqueueTranslateRequest: (data: {
    text: string
    langConfig: Config["language"]
    providerRef: SerializableProviderRef
    scheduleAt: number
    hash: string
    textFormat?: TranslationTextFormat
    // Source line breaks are semantic (newline-preserving container or typed
    // input); providers whose transport collapses "\n" must protect them.
    preserveLineBreaks?: boolean
    webTitle?: string | null
    webDescription?: string | null
    webContent?: string | null
    webSummary?: string | null
    // Page-translation session this request belongs to; scopes the request
    // for cancelPageTranslationRequests. Absent for non-page requests
    // (input/selection translation), which are never cancellable.
    sessionId?: string
    forceRetranslation?: boolean
  }) => Promise<string>
  // Drain queued/in-flight page-translation requests of one session (#1881).
  // The background composes the scope as `${sender.tab.id}:${sessionId}`, so a
  // tab can only ever cancel its own requests.
  cancelPageTranslationRequests: (data: { sessionId: string }) => void
  getOrGenerateWebPageSummary: (data: {
    webTitle: string
    webContent: string
    providerRef: SerializableProviderRef
  }) => Promise<string | null>
  /**
   * One message for a whole window of cues, not one per cue. The per-cue
   * version paid a message round trip and an IndexedDB read per subtitle, and
   * — worse — admitted the cues to the background one at a time, so the batch
   * queue could never compose them.
   */
  enqueueSubtitlesTranslateBatch: (data: {
    items: Array<{
      text: string
      hash: string
      // How far the cue's start is ahead of the playback position, in ms, at
      // request time. Lets the batch queue hold below-min batches until their
      // earliest cue nears playback instead of force-flushing at batchDelay.
      // Absent for full-video downloads (no playback position).
      startsInMs?: number
    }>
    langConfig: Config["language"]
    scheduleAt: number
    webTitle?: string | null
    webDescription?: string | null
    summary?: string | null
  }) => Promise<{
    // null marks a cue whose request failed, so a partial failure still renders
    // the cues that succeeded instead of blanking the whole window.
    translations: (string | null)[]
    // Friendly message from the first failure; only consulted when every cue
    // failed and the caller has to show something.
    errorMessage?: string
  }>
  getSubtitlesSummary: (data: {
    videoTitle: string
    subtitlesContext: string
    providerRef: SerializableProviderRef
  }) => Promise<string | null>
  // Unified translation exit for callers outside the main queues (options
  // connection test): the background executes executeTranslate
  // directly — no rate limiting, batching, or caching — so those pages never
  // issue translation network requests (or carry the AI SDK) themselves.
  directTranslate: (data: {
    text: string
    langConfig: Config["language"]
    providerConfig: ProviderConfig
    textFormat?: TranslationTextFormat
    preserveLineBreaks?: boolean
  }) => Promise<string>
  backgroundGenerateText: (
    data: BackgroundGenerateTextPayload,
  ) => Promise<BackgroundGenerateTextResponse>
  // AI subtitle segmentation
  aiSegmentSubtitles: (data: {
    jsonContent: string
    providerRef: SerializableProviderRef
  }) => Promise<string>
  // network proxy
  backgroundFetch: (data: ProxyRequest) => Promise<ProxyResponse>
  // cache management
  clearAllTranslationRelatedCache: () => Promise<void>
  clearAiSegmentationCache: () => Promise<void>
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>()
