import type { Config } from "@/types/config/config"
import { getCachedConfig } from "@/utils/config/storage"
import {
  DEFAULT_TRANSLATE_LOOK_AHEAD_SECONDS,
  MAX_SEEK_PREFETCH_MS,
  MIN_SEEK_JUMP_MS,
  SEEK_PREFETCH_MULTIPLIER,
  TRANSLATE_LEAD_MS,
  TRANSLATE_TICK_INTERVAL_MS,
} from "@/utils/constants/subtitles"
import { getErrorMessage } from "@/utils/error/message"
import { effectiveLookAheadMs } from "@/utils/subtitles/lookahead"
import type { SubtitlesVideoContext } from "@/utils/subtitles/processor/translator"
import { translateSubtitles } from "@/utils/subtitles/processor/translator"
import type { SubtitlesFragment, SubtitlesState } from "@/utils/subtitles/types"
import { findActiveCue, lowerBoundByStart } from "@/utils/subtitles/utils"
import { adPlayingAtom, subtitlesStore } from "./atoms"
import type { SegmentationPipeline } from "./segmentation-pipeline"

export interface TranslationCoordinatorOptions {
  getFragments: () => SubtitlesFragment[]
  getVideoElement: () => HTMLVideoElement | null
  getCurrentState: () => SubtitlesState
  segmentationPipeline: SegmentationPipeline | null
  onTranslated: (fragments: SubtitlesFragment[]) => void
  onStateChange: (state: SubtitlesState, data?: Record<string, string>) => void
}

function fragmentIdentity(fragment: Pick<SubtitlesFragment, "end" | "text">): string {
  return `${fragment.end}\0${fragment.text}`
}

export class TranslationCoordinator {
  private translatingStarts = new Set<number>()
  private translatedStarts = new Set<number>()
  private failedStarts = new Set<number>()
  /** Identity of the cue (end+text) associated with a booked start. */
  private knownIdentities = new Map<number, string>()
  /** False after stop(); blocks chained ticks and in-flight result application. */
  private active = false
  /** Bumped on stop() so in-flight batches cannot apply after stop/start. */
  private runId = 0
  private lastEmittedState: SubtitlesState = "idle"
  private videoContext: SubtitlesVideoContext = { videoTitle: "", subtitlesTextContent: "" }
  private listenersAttached = false
  /**
   * Playhead observed by the most recent tick. Snapshotted when `seeking`
   * fires so the next tick can measure how far the seek jumped.
   */
  private lastTickTimeMs: number | null = null
  /** Non-null between `seeking` and the first tick that follows it. */
  private seekFromMs: number | null = null
  /**
   * True until a window request is booked. In steady state every cue gets
   * requested while it still sits a TRANSLATE_LEAD_MS ahead of the playhead, so
   * the near zone can be skipped — but nothing ever covered it at a cold start
   * (feature on, new session, a big seek landing): its cues would never be
   * requested at all, leaving translationOnly blank for the whole lead. The
   * first window of each such stretch reaches down to the playhead instead.
   */
  private nearZonePending = true
  /**
   * Backstop timer for the video-event-driven ticks. `timeupdate` only fires
   * while the playhead moves, so a paused player, a stalled round or the
   * 5-second error state would otherwise leave the look-ahead window unfed —
   * idle capacity is exactly when prefetching is free.
   */
  private tickTimerId: ReturnType<typeof setInterval> | null = null

  private getFragments: () => SubtitlesFragment[]
  private getVideoElement: () => HTMLVideoElement | null
  private getCurrentState: () => SubtitlesState
  private segmentationPipeline: SegmentationPipeline | null
  private onTranslated: (fragments: SubtitlesFragment[]) => void
  private onStateChange: (state: SubtitlesState, data?: Record<string, string>) => void

  constructor(options: TranslationCoordinatorOptions) {
    this.getFragments = options.getFragments
    this.getVideoElement = options.getVideoElement
    this.getCurrentState = options.getCurrentState
    this.segmentationPipeline = options.segmentationPipeline
    this.onTranslated = options.onTranslated
    this.onStateChange = options.onStateChange
  }

  start(videoContext?: SubtitlesVideoContext) {
    if (videoContext !== undefined) {
      this.videoContext = videoContext
    }

    const video = this.getVideoElement()
    if (!video) return

    this.active = true
    this.nearZonePending = true
    this.attachVideoListeners(video)
    this.startTickTimer()

    if (this.segmentationPipeline) {
      this.segmentationPipeline.start()
    }

    this.handleTranslationTick()
  }

  stop() {
    this.active = false
    this.runId += 1
    // Allow a subsequent start() to translate immediately; in-flight rounds are
    // invalidated by runId and must not apply their results.
    this.translatingStarts.clear()
    this.stopTickTimer()
    this.detachVideoListeners()
    this.segmentationPipeline?.stop()
  }

  /** Kick a nearby pass without waiting for the next timeupdate (e.g. after an ad). */
  requestTick() {
    if (!this.active) return
    this.handleTranslationTick()
  }

  reset() {
    this.active = false
    this.runId += 1
    this.stopTickTimer()
    this.detachVideoListeners()
    this.translatingStarts.clear()
    this.translatedStarts.clear()
    this.failedStarts.clear()
    this.knownIdentities.clear()
    this.lastEmittedState = "idle"
    this.lastTickTimeMs = null
    this.seekFromMs = null
    this.videoContext = { videoTitle: "", subtitlesTextContent: "" }
  }

  private startTickTimer() {
    if (this.tickTimerId !== null) return
    this.tickTimerId = setInterval(this.handleTranslationTick, TRANSLATE_TICK_INTERVAL_MS)
  }

  private stopTickTimer() {
    if (this.tickTimerId === null) return
    clearInterval(this.tickTimerId)
    this.tickTimerId = null
  }

  private attachVideoListeners(video: HTMLVideoElement) {
    if (this.listenersAttached) return
    video.addEventListener("timeupdate", this.handleTranslationTick)
    video.addEventListener("seeked", this.handleTranslationTick)
    video.addEventListener("seeking", this.handleSeekingStart)
    if (this.segmentationPipeline) {
      video.addEventListener("seeked", this.handleSeek)
    }
    this.listenersAttached = true
  }

  private detachVideoListeners() {
    if (!this.listenersAttached) return
    const video = this.getVideoElement()
    if (video) {
      video.removeEventListener("timeupdate", this.handleTranslationTick)
      video.removeEventListener("seeked", this.handleTranslationTick)
      video.removeEventListener("seeking", this.handleSeekingStart)
      video.removeEventListener("seeked", this.handleSeek)
    }
    this.listenersAttached = false
  }

  clearFailed() {
    this.failedStarts.clear()
  }

  /**
   * Drop bookkeeping for starts that no longer exist, or whose cue identity
   * (end+text) changed after AI re-segmentation — same start can be a recut line.
   */
  noteFragmentListChanged() {
    if (!this.active) return

    const byStart = new Map(this.getFragments().map((fragment) => [fragment.start, fragment]))

    this.invalidateStaleStarts(this.translatedStarts, byStart)
    this.invalidateStaleStarts(this.translatingStarts, byStart)
    this.invalidateStaleStarts(this.failedStarts, byStart)
    // A recut can land new cue identities inside the near zone; re-fetch it so
    // they are requested instead of being skipped for the rest of the session.
    this.nearZonePending = true

    this.handleTranslationTick()
  }

  private invalidateStaleStarts(starts: Set<number>, byStart: Map<number, SubtitlesFragment>) {
    for (const start of [...starts]) {
      const current = byStart.get(start)
      if (!current) {
        starts.delete(start)
        this.knownIdentities.delete(start)
        continue
      }

      const known = this.knownIdentities.get(start)
      if (known !== undefined && known !== fragmentIdentity(current)) {
        starts.delete(start)
        this.knownIdentities.delete(start)
      }
    }
  }

  private rememberIdentity(fragment: SubtitlesFragment) {
    this.knownIdentities.set(fragment.start, fragmentIdentity(fragment))
  }

  private handleTranslationTick = () => {
    if (!this.active) return
    // Ad timeline can freeze or jump; do not translate against main-video cues mid-ad.
    if (subtitlesStore.get(adPlayingAtom)) return

    const video = this.getVideoElement()
    if (!video) return

    const currentTimeMs = video.currentTime * 1000
    const fragments = this.getFragments()

    if (this.getCurrentState() === "error") return

    this.updateLoadingStateAt(currentTimeMs, fragments)

    if (
      this.segmentationPipeline &&
      !this.segmentationPipeline.isRunning &&
      this.segmentationPipeline.hasUnprocessedChunks()
    ) {
      this.segmentationPipeline.restart()
    }

    // A `seeking` event snapshot means this tick may be the landing of a seek:
    // measure the jump against the pre-seek playhead, then consume the snapshot.
    const seekJumpMs = this.seekFromMs !== null ? currentTimeMs - this.seekFromMs : null
    this.seekFromMs = null
    // A big seek (either direction) can land in a stretch whose near zone no
    // earlier window ever covered — re-fetch it like a cold start.
    if (seekJumpMs !== null && Math.abs(seekJumpMs) >= MIN_SEEK_JUMP_MS) {
      this.nearZonePending = true
    }

    this.translateNearby(currentTimeMs, seekJumpMs)
    this.lastTickTimeMs = currentTimeMs
  }

  private async translateNearby(currentTimeMs: number, seekJumpMs: number | null) {
    if (!this.active) return

    // Cached per storage revision; cheap on every tick. Re-check `active` after
    // the await since stop() may have run in between.
    const config = await getCachedConfig()
    if (!this.active) return

    const fragments = this.getFragments()

    const lookAheadSeconds =
      config?.videoSubtitles.translateLookAheadSeconds ?? DEFAULT_TRANSLATE_LOOK_AHEAD_SECONDS
    const lookAheadMs = effectiveLookAheadMs(
      lookAheadSeconds * 1000,
      this.getVideoElement()?.playbackRate,
    )

    // The fragment list is start-sorted, so binary search the earliest eligible
    // cue and stop once the look-ahead bound is passed. Every untranslated cue in
    // the window is enqueued (individually) — how they compose into actual AI
    // requests is the background BatchQueue's job, not this loop's.
    //
    // A forward seek is the one case where the steady-state window is not enough:
    // the window is widened to SEEK_PREFETCH_MULTIPLIER × the jump past the new
    // playhead (capped at MAX_SEEK_PREFETCH_MS) so playback does not have to reach
    // the look-ahead bound again after landing. The background derives each cue's
    // dueAt from its distance to the playhead, so the cues the user just landed on
    // are scheduled ahead of the regular prefetch traffic.
    let latestStart = currentTimeMs + lookAheadMs
    if (seekJumpMs !== null && seekJumpMs >= MIN_SEEK_JUMP_MS) {
      const prefetchMs = Math.min(seekJumpMs * SEEK_PREFETCH_MULTIPLIER, MAX_SEEK_PREFETCH_MS)
      latestStart = Math.max(latestStart, currentTimeMs + prefetchMs)
    }
    // The near zone: a cue closer than TRANSLATE_LEAD_MS to the playhead cannot
    // finish translating before it is read, so requesting it in steady state
    // only pays for a translation that arrives after the line has already been
    // shown. The window therefore starts a lead ahead of the playhead and lets
    // those near cues play in the source language (every cue beyond them was
    // already requested back when it still had the lead's worth of runway) —
    // except while `nearZonePending`, when nothing ever covered the near zone
    // and the window reaches down to the playhead. A look-ahead that does not
    // clear the lead is an explicit on-demand setting (0 = "current line only");
    // it keeps the old window — cue under the playhead included — so such
    // configs still translate.
    const activeCue = findActiveCue(fragments, currentTimeMs)
    const earliestStart =
      lookAheadMs > TRANSLATE_LEAD_MS && !this.nearZonePending
        ? currentTimeMs + TRANSLATE_LEAD_MS
        : activeCue
          ? activeCue.start
          : currentTimeMs
    const batch: SubtitlesFragment[] = []
    for (
      let index = lowerBoundByStart(fragments, earliestStart);
      index < fragments.length;
      index++
    ) {
      const fragment = fragments[index]!
      if (fragment.start > latestStart) break
      if (
        this.translatedStarts.has(fragment.start) ||
        this.translatingStarts.has(fragment.start) ||
        this.failedStarts.has(fragment.start)
      ) {
        continue
      }
      batch.push(fragment)
    }

    if (batch.length === 0) {
      return
    }

    const runId = this.runId
    // Book the starts synchronously so overlapping ticks cannot re-enqueue them.
    batch.forEach((f) => {
      this.translatingStarts.add(f.start)
      this.rememberIdentity(f)
    })
    // First window of this stretch booked — steady-state lead skipping applies again.
    this.nearZonePending = false

    // Fire-and-forget: the tick loop must not wait on this round's requests, or a
    // pending sub-minItemsPerBatch batch in the queue could never absorb later arrivals.
    void this.applyTranslationResult(batch, runId, currentTimeMs, config)
  }

  /** Whether this round still belongs to the current active run. */
  private isCurrentRun(runId: number): boolean {
    return this.active && runId === this.runId
  }

  private async applyTranslationResult(
    batch: SubtitlesFragment[],
    runId: number,
    requestedTimeMs: number,
    config: Config | null,
  ) {
    // Publish a cue the instant its own request lands, instead of waiting for the
    // whole look-ahead window to return. The background deliberately holds a far
    // prefetch cue until it nears playback (dueAt); without this, every near cue
    // in the same window — including the line the viewer is reading — sat pinned
    // behind that farthest sibling, so a larger look-ahead made "loading" last
    // longer, the opposite of its purpose.
    const publishOne = (fragment: SubtitlesFragment) => {
      if (!this.isCurrentRun(runId)) return
      const [valid] = this.filterIdentityValid([fragment])
      if (!valid) return
      this.translatingStarts.delete(valid.start)
      this.translatedStarts.add(valid.start)
      this.rememberIdentity(valid)
      this.onTranslated([valid])
      this.updateLoadingStateAt(this.getCurrentVideoTimeMs(requestedTimeMs), this.getFragments())
    }

    try {
      const translated = await translateSubtitles(
        batch,
        this.videoContext,
        config,
        requestedTimeMs,
        publishOne,
      )
      if (!this.isCurrentRun(runId)) {
        return
      }

      // Only accept results whose cue identity still matches the current fragment list.
      const stillValid = this.filterIdentityValid(translated)

      stillValid.forEach((f) => {
        this.translatingStarts.delete(f.start)
        this.translatedStarts.add(f.start)
        this.rememberIdentity(f)
      })
      // Starts that disappeared or were recut mid-request should not stay "translating".
      batch.forEach((f) => {
        this.translatingStarts.delete(f.start)
      })
      this.onTranslated(stillValid)

      const latestTimeMs = this.getCurrentVideoTimeMs(requestedTimeMs)
      const latestFragments = this.getFragments()
      this.updateLoadingStateAt(latestTimeMs, latestFragments)
    } catch (error) {
      if (!this.isCurrentRun(runId)) {
        return
      }

      // Starts that disappeared or were recut mid-request should not stay "translating".
      batch.forEach((f) => {
        this.translatingStarts.delete(f.start)
      })

      // Same identity gate as the success path: never bookkeep or publish recut/stale cues.
      const stillValid = this.filterIdentityValid(batch)
      stillValid.forEach((f) => {
        this.failedStarts.add(f.start)
        this.rememberIdentity(f)
      })

      const config = await getCachedConfig()
      if (!this.isCurrentRun(runId)) {
        return
      }

      // Re-check after the await: AI recut may have landed while config was loading.
      const validForFallback = this.filterIdentityValid(stillValid)
      const displayMode = config?.videoSubtitles?.style.displayMode
      const fallback =
        displayMode === "translationOnly"
          ? validForFallback.map((f) => ({ ...f, translation: f.text }))
          : validForFallback.map((f) => ({ ...f, translation: "" }))
      if (fallback.length > 0) {
        this.onTranslated(fallback)
      }

      const errorMessage = getErrorMessage(error)
      this.lastEmittedState = "error"
      this.onStateChange("error", { message: errorMessage })
    } finally {
      // Only the current generation may chain another tick to drain remaining work.
      if (this.isCurrentRun(runId)) {
        this.handleTranslationTick()
      }
    }
  }

  private getCurrentVideoTimeMs(fallbackTimeMs: number): number {
    const video = this.getVideoElement()
    if (!video) {
      return fallbackTimeMs
    }
    return video.currentTime * 1000
  }

  /** Keep only cues whose start+end+text still match the live fragment list. */
  private filterIdentityValid(fragments: SubtitlesFragment[]): SubtitlesFragment[] {
    const byStart = new Map(this.getFragments().map((fragment) => [fragment.start, fragment]))
    return fragments.filter((fragment) => {
      const current = byStart.get(fragment.start)
      return !!current && current.end === fragment.end && current.text === fragment.text
    })
  }

  private updateLoadingStateAt(timeMs: number, fragments: SubtitlesFragment[]) {
    const activeCue = findActiveCue(fragments, timeMs)

    if (activeCue) {
      // Only an in-flight request earns the badge. An unresolved cue with no
      // request in flight sits inside the skipped near zone (see
      // `translateNearby`): no translation is coming for it, and flagging it
      // "loading" would spin the badge through the whole lead.
      const nextState: SubtitlesState = this.translatingStarts.has(activeCue.start)
        ? "loading"
        : "idle"
      if (nextState === this.lastEmittedState) return
      this.lastEmittedState = nextState
      this.onStateChange(nextState)
      return
    }

    // Gap / music intro / before first cue: never keep the corner loading badge up.
    // Adapter may have set "loading" before fragments were ready; lastEmittedState can
    // still be "idle" while the scheduler state remains "loading" — always clear it.
    if (this.lastEmittedState === "idle" && this.getCurrentState() !== "loading") {
      return
    }
    this.lastEmittedState = "idle"
    this.onStateChange("idle")
  }

  private handleSeek = () => {
    this.segmentationPipeline?.restart()
  }

  /**
   * `seeking` fires before `seeked`, while `currentTime` already reports the
   * landing position — so the jump distance can only be measured against the
   * last playhead the tick loop observed. Snapshot it and let the next tick
   * (usually the `seeked` one) consume the snapshot. This also fires for
   * backward seeks; those produce a negative jump and are ignored downstream.
   */
  private handleSeekingStart = () => {
    this.seekFromMs = this.lastTickTimeMs
  }
}
