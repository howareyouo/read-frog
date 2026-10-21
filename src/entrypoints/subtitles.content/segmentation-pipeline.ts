import { getCachedConfig } from "@/utils/config/storage"
import {
  DEFAULT_TRANSLATE_LOOK_AHEAD_SECONDS,
  PROCESS_LOOK_AHEAD_MS,
} from "@/utils/constants/subtitles"
import type { SerializableProviderRef } from "@/utils/providers/provider-ref"
import { effectiveLookAheadMs } from "@/utils/subtitles/lookahead"
import { segmentChunkWithFallback } from "@/utils/subtitles/processor/ai-segmentation"
import { optimizeSubtitles } from "@/utils/subtitles/processor/optimizer"
import type { SubtitlesFragment } from "@/utils/subtitles/types"
import { lowerBoundByStart, replaceFragmentWindow } from "@/utils/subtitles/utils"

export type ChunkSegmentedHandler = (
  chunk: SubtitlesFragment[],
  nextFragments: SubtitlesFragment[],
  windowStartMs: number,
  windowEndMs: number,
) => void

export class SegmentationPipeline {
  // Segmented results, read by translation pipeline
  processedFragments: SubtitlesFragment[] = []

  private rawFragments: SubtitlesFragment[]
  private segmentedRawStarts = new Set<number>()
  private aiSegmentFailedRawStarts = new Set<number>()
  /** rawFragments not yet in segmentedRawStarts — kept exact so hasUnprocessedChunks is O(1). */
  private pendingCount: number
  private running = false
  private stopped = false

  private getVideoElement: () => HTMLVideoElement | null
  private getSourceLanguage: () => string
  private preSegmented: boolean
  private onChunkSegmented: ChunkSegmentedHandler | null
  /**
   * Called once per chunk, not once per session.
   *
   * A ref resolved at construction pinned every chunk of the video to one
   * provider — the primary — while the other selected keys sat idle. Rotation
   * is cheap and stateless on the caller's side, and resolving per chunk also
   * lets a provider that starts cooling down mid-video drop out of the
   * rotation for the chunks that follow.
   *
   * Null means AI segmentation cannot run right now; chunks then fall back to
   * rule-based optimization and stay retryable.
   */
  private resolveProviderRef: () => SerializableProviderRef | null

  constructor(options: {
    baselineFragments?: SubtitlesFragment[]
    rawFragments: SubtitlesFragment[]
    getVideoElement: () => HTMLVideoElement | null
    getSourceLanguage: () => string
    resolveProviderRef: () => SerializableProviderRef | null
    preSegmented?: boolean
    onChunkSegmented?: ChunkSegmentedHandler
  }) {
    this.rawFragments = options.rawFragments
    this.processedFragments = [...(options.baselineFragments ?? [])]
    this.pendingCount = options.rawFragments.length
    this.getVideoElement = options.getVideoElement
    this.getSourceLanguage = options.getSourceLanguage
    this.resolveProviderRef = options.resolveProviderRef
    this.preSegmented = options.preSegmented ?? false
    this.onChunkSegmented = options.onChunkSegmented ?? null
  }

  get isRunning(): boolean {
    return this.running
  }

  hasUnprocessedChunks(): boolean {
    return this.pendingCount > 0
  }

  start() {
    this.stopped = false
    void this.runLoop()
  }

  stop() {
    this.stopped = true
  }

  restart() {
    void this.runLoop()
  }

  clearFailedStarts() {
    for (const start of this.aiSegmentFailedRawStarts) {
      if (this.segmentedRawStarts.delete(start)) {
        this.pendingCount++
      }
    }
    this.aiSegmentFailedRawStarts.clear()
  }

  private async runLoop() {
    if (this.running) return
    this.running = true

    const video = this.getVideoElement()
    if (!video) {
      this.running = false
      return
    }

    try {
      while (!this.stopped && this.hasUnprocessedChunks()) {
        const didWork = await this.processNextChunk(video.currentTime * 1000)
        if (!didWork) break
      }
    } finally {
      this.running = false
    }
  }

  private async processNextChunk(currentTimeMs: number): Promise<boolean> {
    if (this.stopped) return false

    const chunk = await this.findNextChunk(currentTimeMs)
    if (chunk.length === 0) return false

    chunk.forEach((f) => this.segmentedRawStarts.add(f.start))
    this.pendingCount -= chunk.length

    const chunkStart = chunk[0]!.start
    const chunkEnd = chunk.at(-1)!.end

    if (this.preSegmented) {
      this.replaceProcessedChunk(chunk, chunkStart, chunkEnd, chunk)
      return true
    }

    const providerRef = this.resolveProviderRef()
    if (!providerRef) {
      // Do not leave starts marked segmented with no replacement (would skip forever).
      this.replaceProcessedChunk(
        chunk,
        chunkStart,
        chunkEnd,
        optimizeSubtitles(chunk, this.getSourceLanguage()),
      )
      // Nothing usable right now usually means every provider is cooling down,
      // which is transient — so the chunk is booked for a retry like an API
      // failure instead of being written off for the rest of the session.
      chunk.forEach((f) => this.aiSegmentFailedRawStarts.add(f.start))
      return true
    }

    const outcome = await segmentChunkWithFallback(chunk, providerRef, this.getSourceLanguage())
    // Session may have been torn down while the AI call was in flight.
    if (this.stopped) {
      chunk.forEach((f) => this.segmentedRawStarts.delete(f.start))
      this.pendingCount += chunk.length
      return true
    }

    // An API failure is retryable via clearFailedStarts(); an unusable model
    // answer is not, so only "error" books the chunk for a retry.
    if (outcome.status === "error") {
      chunk.forEach((f) => this.aiSegmentFailedRawStarts.add(f.start))
    }

    const optimized =
      outcome.status === "ok"
        ? outcome.fragments
        : optimizeSubtitles(chunk, this.getSourceLanguage())
    this.replaceProcessedChunk(chunk, chunkStart, chunkEnd, optimized)

    return true
  }

  private replaceProcessedChunk(
    chunk: SubtitlesFragment[],
    chunkStart: number,
    chunkEnd: number,
    nextFragments: SubtitlesFragment[],
  ) {
    // Do not mutate processed fragments or notify the adapter after stop().
    if (this.stopped) return

    this.processedFragments = replaceFragmentWindow(
      this.processedFragments,
      chunkStart,
      chunkEnd,
      nextFragments,
    )

    this.onChunkSegmented?.(chunk, nextFragments, chunkStart, chunkEnd)
  }

  private async findNextChunk(currentTimeMs: number): Promise<SubtitlesFragment[]> {
    const searchStart = Math.max(0, currentTimeMs - 10_000)
    // Segment ahead of the playhead, but at least as far ahead as the
    // translation look-ahead the user configured: the translator can only
    // translate cues the segmentation track contains, so a hard 60s ceiling
    // here silently capped any larger look-ahead — cues past it never got an AI
    // recut, and when the recut finally landed it wiped their (already
    // translated) starts and forced a re-translate, which is what surfaced as
    // "loading" again after a seek. Without some bound the loop would eagerly
    // send the entire remaining video to the segmentation model instead.
    const config = await getCachedConfig()
    const translateLookAheadMs = effectiveLookAheadMs(
      (config?.videoSubtitles.translateLookAheadSeconds ?? DEFAULT_TRANSLATE_LOOK_AHEAD_SECONDS) *
        1000,
      this.getVideoElement()?.playbackRate,
    )
    const chunkLookAheadMs = effectiveLookAheadMs(
      PROCESS_LOOK_AHEAD_MS,
      this.getVideoElement()?.playbackRate,
    )
    const windowEndBound = currentTimeMs + Math.max(chunkLookAheadMs, translateLookAheadMs)

    // rawFragments is start-sorted, so binary search the lower time bound and scan
    // only the look-ahead window instead of the whole track on every chunk.
    let index = lowerBoundByStart(this.rawFragments, searchStart)
    let firstUnprocessed: SubtitlesFragment | null = null
    for (; index < this.rawFragments.length; index++) {
      const fragment = this.rawFragments[index]!
      if (fragment.start > windowEndBound) return []
      if (!this.segmentedRawStarts.has(fragment.start)) {
        firstUnprocessed = fragment
        break
      }
    }
    if (!firstUnprocessed) return []

    // One AI request stays the same size as before (the chunk window, not the
    // widened search bound): a bigger window is what makes the model drift or
    // emit one cue spanning the whole chunk.
    const windowEnd = firstUnprocessed.start + chunkLookAheadMs
    const chunk: SubtitlesFragment[] = []
    for (; index < this.rawFragments.length; index++) {
      const fragment = this.rawFragments[index]!
      if (fragment.start >= windowEnd) break
      if (this.segmentedRawStarts.has(fragment.start)) continue
      chunk.push(fragment)
    }
    return chunk
  }
}
