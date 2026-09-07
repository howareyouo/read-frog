import type { StateData, SubtitlesFragment, SubtitlesState } from "@/utils/subtitles/types"
import {
  findActiveCueIndex,
  mergeSortedByStart,
  replaceFragmentWindow,
} from "@/utils/subtitles/utils"
import {
  currentSubtitleAtom,
  currentTimeMsAtom,
  subtitlesStateAtom,
  subtitlesStore,
  subtitlesVisibleAtom,
} from "./atoms"

const ERROR_STATE_AUTO_HIDE_MS = 5_000

function cueIdentityKey(fragment: Pick<SubtitlesFragment, "start" | "end" | "text">): string {
  return `${fragment.start}\0${fragment.end}\0${fragment.text}`
}

/**
 * Holds only *translated* cues. Originals live on sourceTrackAtom; the UI falls back there.
 */
export class SubtitlesScheduler {
  private videoElement: HTMLVideoElement
  private subtitles: SubtitlesFragment[] = []
  private currentIndex = -1
  private active = false
  private currentState: StateData = {
    state: "idle",
  }

  private errorAutoHideTimeoutId: ReturnType<typeof setTimeout> | null = null
  /** rAF handle while playing; null when paused/stopped. */
  private rafId: number | null = null

  constructor({ videoElement }: { videoElement: HTMLVideoElement }) {
    this.videoElement = videoElement
    this.attachListeners()
  }

  start() {
    this.active = true
    // Sync immediately: timeupdate may not fire while paused / mid-video.
    this.updateSubtitles(this.videoElement.currentTime)
    this.updateVisibility()
    this.syncRafLoop()
  }

  /**
   * Upsert translated cues by start. New cues are inserted; existing cues get translation updates.
   */
  supplementSubtitles(subtitles: SubtitlesFragment[]) {
    if (subtitles.length === 0) {
      return
    }

    // Index the existing cues by start so the per-cue upsert is O(1). Matching stays
    // start-based — a translation update can legitimately change text/end for
    // the same cue, so keying on the full cue identity would miss it.
    const indexByStart = new Map<number, number>()
    this.subtitles.forEach((s, i) => indexByStart.set(s.start, i))
    let currentSubtitleUpdated = false
    const previousCurrentStart =
      this.currentIndex >= 0 ? (this.subtitles[this.currentIndex]?.start ?? null) : null
    const inserts: SubtitlesFragment[] = []

    for (const newSub of subtitles) {
      const existingIdx = indexByStart.get(newSub.start)

      if (existingIdx === undefined) {
        inserts.push(newSub)
        continue
      }

      if (newSub.translation !== undefined) {
        const existingSub = this.subtitles[existingIdx]
        if (existingSub) {
          this.subtitles[existingIdx] = {
            ...existingSub,
            text: newSub.text,
            end: newSub.end,
            translation: newSub.translation,
          }

          if (previousCurrentStart !== null && newSub.start === previousCurrentStart) {
            currentSubtitleUpdated = true
          }
        }
      }
    }

    // New cues arrive in a batch; one sorted merge keeps the list ordered without
    // re-sorting the whole track on every few translated cues.
    if (inserts.length > 0) {
      inserts.sort((a, b) => a.start - b.start)
      this.subtitles = mergeSortedByStart(this.subtitles, inserts)
    }

    this.updateSubtitles(this.videoElement.currentTime)

    if (currentSubtitleUpdated) {
      this.updateCurrentSubtitle()
    }
  }

  /**
   * After AI recut of a window: drop overlapping translated cues, but re-attach translations
   * whose start+end+text still match a next fragment. Unchanged cues must not be wiped then
   * skipped forever (coordinator still has them in translatedStarts).
   */
  reconcileTranslatedCuesAfterRecut(
    windowStartMs: number,
    windowEndMs: number,
    nextFragments: SubtitlesFragment[],
  ) {
    const overlapping = this.subtitles.filter(
      (fragment) => fragment.end > windowStartMs && fragment.start < windowEndMs,
    )

    const byIdentity = new Map(
      overlapping.map((fragment) => [cueIdentityKey(fragment), fragment] as const),
    )
    const preserved = nextFragments.flatMap((fragment) => {
      const previous = byIdentity.get(cueIdentityKey(fragment))
      if (previous?.translation === undefined) {
        return []
      }
      return [{ ...fragment, translation: previous.translation }]
    })

    const next = replaceFragmentWindow(this.subtitles, windowStartMs, windowEndMs, preserved)
    const unchanged =
      next.length === this.subtitles.length &&
      next.every((fragment, index) => {
        const prev = this.subtitles[index]
        if (!prev) return false
        return (
          prev.start === fragment.start &&
          prev.end === fragment.end &&
          prev.text === fragment.text &&
          prev.translation === fragment.translation
        )
      })
    if (unchanged) {
      return
    }

    this.subtitles = next
    // Force re-resolve: index alone may stay stale while the atom still holds a removed cue.
    this.currentIndex = -1
    this.updateSubtitles(this.videoElement.currentTime)
    this.updateCurrentSubtitle()
  }

  getVideoElement(): HTMLVideoElement {
    return this.videoElement
  }

  getState(): SubtitlesState {
    return this.currentState.state ?? "idle"
  }

  isActive(): boolean {
    return this.active
  }

  stop() {
    this.active = false
    this.syncRafLoop()
    this.detachListeners()
    this.updateVisibility()
  }

  show() {
    this.active = true
    // Sync immediately: timeupdate may not fire while paused / mid-video.
    this.updateSubtitles(this.videoElement.currentTime)
    this.updateVisibility()
    this.syncRafLoop()
  }

  hide() {
    this.active = false
    this.syncRafLoop()
    this.updateVisibility()
  }

  /** Force a cue resolve from the live video clock (e.g. after an ad ends). */
  resyncFromVideo() {
    if (!this.active) return
    this.updateSubtitles(this.videoElement.currentTime)
  }

  setState(state: SubtitlesState, data?: Partial<Omit<StateData, "state">>) {
    this.clearErrorAutoHide()
    this.currentState = {
      state,
      message: data?.message,
    }
    this.updateState()

    if (state === "error") {
      this.errorAutoHideTimeoutId = setTimeout(() => {
        if (this.currentState.state === "error") {
          this.setState("idle")
        }
      }, ERROR_STATE_AUTO_HIDE_MS)
    }
  }

  reset() {
    this.setState("idle")
    this.subtitles = []
    this.currentIndex = -1
    this.updateCurrentSubtitle()
  }

  private attachListeners() {
    const el = this.videoElement
    el.addEventListener("timeupdate", this.handleTimeUpdate)
    el.addEventListener("seeking", this.handleSeeking)
    el.addEventListener("seeked", this.handleSeeking)
    el.addEventListener("play", this.handlePlayStateChange)
    el.addEventListener("playing", this.handlePlayStateChange)
    el.addEventListener("pause", this.handlePlayStateChange)
    el.addEventListener("ended", this.handlePlayStateChange)
    el.addEventListener("ratechange", this.handleRateChange)
  }

  private detachListeners() {
    const el = this.videoElement
    el.removeEventListener("timeupdate", this.handleTimeUpdate)
    el.removeEventListener("seeking", this.handleSeeking)
    el.removeEventListener("seeked", this.handleSeeking)
    el.removeEventListener("play", this.handlePlayStateChange)
    el.removeEventListener("playing", this.handlePlayStateChange)
    el.removeEventListener("pause", this.handlePlayStateChange)
    el.removeEventListener("ended", this.handlePlayStateChange)
    el.removeEventListener("ratechange", this.handleRateChange)
    this.syncRafLoop()
  }

  private handleTimeUpdate = () => {
    if (!this.active) return

    const currentTime = this.videoElement.currentTime
    this.updateSubtitles(currentTime)
  }

  private handleSeeking = () => {
    if (!this.active) return

    const currentTime = this.videoElement.currentTime
    this.updateSubtitles(currentTime)
  }

  private handlePlayStateChange = () => {
    if (!this.active) return

    this.updateSubtitles(this.videoElement.currentTime)
    this.syncRafLoop()
  }

  private handleRateChange = () => {
    // No re-render needed on its own, but playback state may have flipped.
    if (!this.active) return
    this.syncRafLoop()
  }

  /**
   * Run a rAF loop while the video is playing. `timeupdate` only fires ~4x/s, so cue
   * switches would lag up to ~250ms behind the picture — visible as subtitles that
   * change "late". rAF tracks the frame the video is painted on; when the tab is
   * backgrounded it throttles and `timeupdate` remains the fallback.
   */
  private syncRafLoop() {
    const shouldRun = this.active && !this.videoElement.paused && !this.videoElement.ended
    if (shouldRun && this.rafId === null) {
      this.rafId = requestAnimationFrame(this.handleRafTick)
      return
    }
    if (!shouldRun && this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private handleRafTick = () => {
    this.rafId = null
    if (!this.active) return
    this.updateSubtitles(this.videoElement.currentTime)
    this.syncRafLoop()
  }

  private updateSubtitles(currentTime: number) {
    const timeMs = currentTime * 1000

    // Per-frame fast path: the current cue still covers now, so nothing visible can
    // change. Skip both the cue rescan and the atom write — writing timeMs here would
    // recompute the whole display atom chain for an identical result.
    const current = this.currentIndex >= 0 ? this.subtitles[this.currentIndex] : undefined
    if (current && current.start <= timeMs && current.end > timeMs) {
      return
    }

    subtitlesStore.set(currentTimeMsAtom, timeMs)

    // Latest-starting cover wins: cues may overlap after a recut, and picking the
    // earliest match would keep a stale line on screen for the whole overlap.
    const newIndex = findActiveCueIndex(this.subtitles, timeMs)

    if (newIndex !== this.currentIndex) {
      this.currentIndex = newIndex
      this.updateCurrentSubtitle()
    }
  }

  private updateCurrentSubtitle() {
    const currentSubtitle = this.currentIndex >= 0 ? this.subtitles[this.currentIndex] : null
    subtitlesStore.set(currentSubtitleAtom, currentSubtitle!)
  }

  private updateState() {
    const stateData = this.currentState.state !== "idle" ? this.currentState : null
    subtitlesStore.set(subtitlesStateAtom, stateData)
  }

  private clearErrorAutoHide() {
    if (this.errorAutoHideTimeoutId !== null) {
      clearTimeout(this.errorAutoHideTimeoutId)
      this.errorAutoHideTimeoutId = null
    }
  }

  private updateVisibility() {
    subtitlesStore.set(subtitlesVisibleAtom, this.active)
  }
}
