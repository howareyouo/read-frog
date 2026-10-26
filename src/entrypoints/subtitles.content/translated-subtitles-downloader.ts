import { toastManager } from "@/components/ui/base-ui/toast"
import type { PlatformConfig } from "@/entrypoints/subtitles.content/platforms"
import type { Config } from "@/types/config/config"
import { getCachedConfig } from "@/utils/config/storage"
import { PROCESS_LOOK_AHEAD_MS } from "@/utils/constants/subtitles"
import { resolveLanguageCodeFromLocale } from "@/utils/content/page-language"
import { getErrorMessage } from "@/utils/error/message"
import { i18n } from "@/utils/i18n"
import type { SerializableProviderRef } from "@/utils/providers/provider-ref"
import type { SubtitlesFetcher } from "@/utils/subtitles/fetchers/types"
import { segmentChunkWithFallback } from "@/utils/subtitles/processor/ai-segmentation"
import { optimizeSubtitles } from "@/utils/subtitles/processor/optimizer"
import type { SubtitlesVideoContext } from "@/utils/subtitles/processor/translator"
import {
  buildSubtitlesSummaryContextHash,
  fetchSubtitlesSummary,
  resolveSegmentationProviderRef,
  resolveSubtitlesProviderRef,
  translateSubtitles,
} from "@/utils/subtitles/processor/translator"
import { downloadSubtitlesAsSrt } from "@/utils/subtitles/srt"
import type { SubtitlesFragment } from "@/utils/subtitles/types"
import {
  subtitlesStore,
  TranslatedDownloadPhase,
  translatedSubtitlesDownloadStatusAtom,
} from "./atoms"

const SUCCESS_MESSAGE_DURATION_MS = 4000
const TRANSLATED_EXPORT_BATCH_CONCURRENCY = 2
/** A second full pass over the fragments whose first translation came back empty. */
const EXPORT_TRANSLATION_PASSES = 2
/**
 * Fragments per `translateSubtitles` round. Export-only grouping for progress
 * reporting and wholesale-failure retry isolation — the actual AI request
 * composition is owned by the background BatchQueue (maxItemsPerBatch etc.).
 */
const EXPORT_TRANSLATION_CHUNK_SIZE = 5

export class TranslatedSubtitlesDownloader {
  private isDownloading = false
  private operationId = 0
  private successTimeout: ReturnType<typeof setTimeout> | null = null
  private snapshotFetcher: SubtitlesFetcher | null = null

  constructor(
    private getFetcher: () => SubtitlesFetcher,
    private config: PlatformConfig,
  ) {}

  private get fetcher(): SubtitlesFetcher {
    return this.snapshotFetcher ?? this.getFetcher()
  }

  download = async (): Promise<void> => {
    if (this.isDownloading) {
      return
    }

    this.clearSuccessTimeout()
    this.isDownloading = true
    this.snapshotFetcher = this.getFetcher()
    const operationId = ++this.operationId
    const pageTitle = document.title || ""
    const videoId = this.config.getVideoId?.()
    this.setStatus(TranslatedDownloadPhase.Checking, null)

    try {
      const configSnapshot = await getCachedConfig()
      this.assertActive(operationId)
      if (!configSnapshot) {
        throw new Error(i18n.t("subtitles.errors.translatedExportFailed"))
      }

      const sourceSubtitles = await this.fetcher.fetch()
      this.assertActive(operationId)
      if (sourceSubtitles.length === 0) {
        throw new Error(i18n.t("subtitles.errors.noSubtitlesFound"))
      }

      this.assertDifferentTargetLanguage(configSnapshot)
      this.setStatus(TranslatedDownloadPhase.Preparing, 0)

      const sourceProcessedSubtitles = this.fetcher.isPreSegmented?.()
        ? [...sourceSubtitles]
        : optimizeSubtitles(sourceSubtitles, this.fetcher.getSourceLanguage())
      const translatedSubtitles = await this.buildCompleteTranslatedSubtitles(
        sourceSubtitles,
        sourceProcessedSubtitles,
        configSnapshot,
        operationId,
        pageTitle,
      )

      this.assertActive(operationId)
      await downloadSubtitlesAsSrt({
        subtitles: translatedSubtitles.map(({ translation, ...fragment }) => ({
          ...fragment,
          text: translation ?? "",
        })),
        pageTitle,
        videoId,
        suffix: "translated",
      })
      this.assertActive(operationId)

      this.setStatus(TranslatedDownloadPhase.Complete, null)
      this.successTimeout = setTimeout(() => {
        if (!this.isActive(operationId)) {
          return
        }
        this.successTimeout = null
        this.setStatus(TranslatedDownloadPhase.Idle, null)
      }, SUCCESS_MESSAGE_DURATION_MS)
    } catch (error) {
      if (!this.isActive(operationId)) {
        return
      }
      toastManager.add({
        type: "error",
        title: getErrorMessage(error),
      })
      this.setStatus(TranslatedDownloadPhase.Idle, null)
    } finally {
      if (this.isActive(operationId)) {
        this.isDownloading = false
        this.snapshotFetcher = null
      }
    }
  }

  dispose(): void {
    this.operationId++
    this.isDownloading = false
    this.snapshotFetcher = null
    this.clearSuccessTimeout()
    this.setStatus(TranslatedDownloadPhase.Idle, null)
  }

  private clearSuccessTimeout(): void {
    if (this.successTimeout !== null) {
      clearTimeout(this.successTimeout)
      this.successTimeout = null
    }
  }

  private setStatus(phase: TranslatedDownloadPhase, progress: number | null): void {
    subtitlesStore.set(translatedSubtitlesDownloadStatusAtom, { phase, progress })
  }

  private isActive(operationId: number): boolean {
    return operationId === this.operationId
  }

  private assertActive(operationId: number): void {
    if (!this.isActive(operationId)) {
      throw new Error("Translated subtitle download was disposed")
    }
  }

  private assertDifferentTargetLanguage(config: Config): void {
    const targetLanguage = config.language.targetCode
    const sourceLanguage = resolveLanguageCodeFromLocale(this.fetcher.getSourceLanguage())

    if (targetLanguage && sourceLanguage && sourceLanguage === targetLanguage) {
      throw new Error(i18n.t("subtitles.errors.translatedExportSameLanguage"))
    }
  }

  private async buildCompleteTranslatedSubtitles(
    sourceSubtitles: SubtitlesFragment[],
    sourceProcessedSubtitles: SubtitlesFragment[],
    config: Config,
    operationId: number,
    pageTitle: string,
  ): Promise<SubtitlesFragment[]> {
    // One resolve for the whole export.
    const providerRef = await resolveSubtitlesProviderRef(config)
    this.assertActive(operationId)
    const fragments = await this.buildExportProcessedSubtitles(
      sourceSubtitles,
      sourceProcessedSubtitles,
      config,
      operationId,
    )
    this.assertActive(operationId)
    const videoContext = await this.buildExportVideoContext(
      sourceSubtitles,
      config,
      operationId,
      pageTitle,
      providerRef,
    )
    this.assertActive(operationId)

    // Index-addressed output: retry passes fill slots in place, so the SRT keeps
    // source order no matter which pass completed a fragment.
    const output: (SubtitlesFragment | undefined)[] = new Array(fragments.length)
    let pending: Array<{ index: number; fragment: SubtitlesFragment }> = fragments.map(
      (fragment, index) => ({ index, fragment }),
    )
    let translatedCount = 0

    // One full pass, then a retry pass for fragments whose translation came back
    // empty — a lone failed request no longer aborts an almost-finished export.
    for (let pass = 0; pass < EXPORT_TRANSLATION_PASSES && pending.length > 0; pass++) {
      const batches = this.buildTranslationBatches(pending)
      const nextPending: Array<{ index: number; fragment: SubtitlesFragment }> = []

      for (let index = 0; index < batches.length; index += TRANSLATED_EXPORT_BATCH_CONCURRENCY) {
        const batchWindow = batches.slice(index, index + TRANSLATED_EXPORT_BATCH_CONCURRENCY)
        // A batch that throws wholesale (its translations all failed) re-joins the
        // retry queue instead of discarding the work done so far.
        const translatedWindows = await Promise.all(
          batchWindow.map(async (batch) => {
            try {
              return await translateSubtitles(
                batch.map((entry) => entry.fragment),
                videoContext,
                config,
              )
            } catch {
              return null
            }
          }),
        )
        this.assertActive(operationId)

        batchWindow.forEach((batch, windowIndex) => {
          const translatedBatch = translatedWindows[windowIndex]
          if (!translatedBatch) {
            nextPending.push(...batch)
            return
          }

          batch.forEach((entry, entryIndex) => {
            const translated = translatedBatch[entryIndex]
            if (translated && translated.translation?.trim()) {
              output[entry.index] = translated
              translatedCount++
            } else {
              nextPending.push(entry)
            }
          })
          this.setStatus(
            TranslatedDownloadPhase.Translating,
            Math.min(100, Math.round((translatedCount / fragments.length) * 100)),
          )
        })
      }

      pending = nextPending
    }

    if (pending.length > 0) {
      throw new Error(i18n.t("subtitles.errors.translatedExportIncomplete"))
    }

    return output.map((fragment) => fragment!)
  }

  private buildTranslationBatches<T>(items: T[]): T[][] {
    const batches: T[][] = []

    for (let index = 0; index < items.length; index += EXPORT_TRANSLATION_CHUNK_SIZE) {
      batches.push(items.slice(index, index + EXPORT_TRANSLATION_CHUNK_SIZE))
    }

    return batches
  }

  private async buildExportProcessedSubtitles(
    sourceSubtitles: SubtitlesFragment[],
    sourceProcessedSubtitles: SubtitlesFragment[],
    config: Config,
    operationId: number,
  ): Promise<SubtitlesFragment[]> {
    if (!config.videoSubtitles.aiSegmentation || this.fetcher.isPreSegmented?.()) {
      return [...sourceProcessedSubtitles]
    }

    const result: SubtitlesFragment[] = []

    for (const chunk of this.buildSourceSubtitleChunks(sourceSubtitles)) {
      result.push(...(await this.buildExportProcessedChunk(chunk, config, operationId)))
      this.assertActive(operationId)
    }

    return result.sort((a, b) => a.start - b.start)
  }

  private async buildExportProcessedChunk(
    chunk: SubtitlesFragment[],
    config: Config,
    operationId: number,
  ): Promise<SubtitlesFragment[]> {
    const sourceLanguage = this.fetcher.getSourceLanguage()

    // One rotation step per chunk: an export walks the whole video, so a ref
    // held for the duration would put every cut on the primary provider.
    const providerRef = resolveSegmentationProviderRef(config)
    this.assertActive(operationId)
    if (!providerRef) {
      return optimizeSubtitles(chunk, sourceLanguage)
    }

    const outcome = await segmentChunkWithFallback(chunk, providerRef, sourceLanguage)
    this.assertActive(operationId)
    if (outcome.status === "ok") {
      return outcome.fragments
    }

    // Retry once with half-size windows before giving up on the whole chunk:
    // a model that drifts on long context often behaves on short ones.
    const retryChunks = this.buildSourceSubtitleChunks(chunk, PROCESS_LOOK_AHEAD_MS / 2)
    if (retryChunks.length > 1) {
      const retryResult: SubtitlesFragment[] = []

      for (const retryChunk of retryChunks) {
        const retryOutcome = await segmentChunkWithFallback(retryChunk, providerRef, sourceLanguage)
        this.assertActive(operationId)
        if (retryOutcome.status !== "ok") {
          return optimizeSubtitles(chunk, sourceLanguage)
        }
        retryResult.push(...retryOutcome.fragments)
      }

      return retryResult
    }

    return optimizeSubtitles(chunk, sourceLanguage)
  }

  private buildSourceSubtitleChunks(
    subtitles: SubtitlesFragment[],
    maxDurationMs = PROCESS_LOOK_AHEAD_MS,
  ): SubtitlesFragment[][] {
    const chunks: SubtitlesFragment[][] = []
    let index = 0

    while (index < subtitles.length) {
      const chunkStart = subtitles[index]!.start
      const chunkEnd = chunkStart + maxDurationMs
      const chunk: SubtitlesFragment[] = []

      while (index < subtitles.length && subtitles[index]!.start < chunkEnd) {
        chunk.push(subtitles[index]!)
        index++
      }

      chunks.push(chunk)
    }

    return chunks
  }

  private async buildExportVideoContext(
    sourceSubtitles: SubtitlesFragment[],
    config: Config,
    operationId: number,
    pageTitle: string,
    providerRef: SerializableProviderRef | null,
  ): Promise<SubtitlesVideoContext> {
    const videoContext: SubtitlesVideoContext = {
      videoTitle: pageTitle,
      subtitlesTextContent: sourceSubtitles.map((fragment) => fragment.text).join(""),
    }
    const summaryContextHash = buildSubtitlesSummaryContextHash(
      videoContext,
      providerRef ?? undefined,
    )

    if (summaryContextHash) {
      try {
        videoContext.summary = await fetchSubtitlesSummary(videoContext, config)
        this.assertActive(operationId)
      } catch {
        videoContext.summary = null
      }
    }

    return videoContext
  }
}
