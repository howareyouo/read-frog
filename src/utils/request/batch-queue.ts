import { getRandomUUID } from "@/utils/crypto-polyfill"
import { TranslationCancelledError } from "./cancellation"

export class BatchCountMismatchError extends Error {
  /**
   * Trusted prefix of per-item results, when the parser could salvage one.
   * Index i of `partialResults` corresponds to task i; entries past the end
   * (or the property being undefined) must go through per-item fallback. The
   * batch retry loop skips its backoff-retry when a salvage exists: a model
   * that merged segments on attempt one will merge them again on identical
   * input, so the missing tail goes straight to individual requests.
   */
  partialResults?: unknown[]

  constructor(expected: number, got: number, results: unknown[], partialResults?: unknown[]) {
    super(
      `Batch result count mismatch: expected ${expected}, got ${got}.\nResults: ["${results.join('",\n"')}"]`,
    )
    this.name = "BatchCountMismatchError"
    this.partialResults = partialResults
  }
}

const BASE_BACKOFF_DELAY_MS = 1000
const MAX_BACKOFF_DELAY_MS = 8000
// While the dispatch gate reports no free slot, re-poll it at least this often
// (the ETA shrinks as tokens refill downstream).
const MAX_GATE_POLL_MS = 1000
// Cap on a single schedule() sleep. A below-min batch with no dispatch slot to
// take may hold past its window for composition, but only up to
// MAX_COMPOSITION_HOLD_MS — the cap just keeps the timer short enough to be
// reliable across service-worker suspensions.
const MAX_HOLD_WAKE_MS = 30_000
// How long a below-min batch may keep composing past its window while the
// dispatch gate is backed up, even though its earliest item is far from due.
// Without a cap the hold lasts the whole remaining lead time, so a look-ahead
// prefetch of minutes sat untranslated until playback nearly reached it — the
// user's configured look-ahead silently did nothing whenever the provider was
// busy. Past the cap the batch flushes below-min (ignoring the gate); the
// RequestQueue still orders it by dueAt, so near cues keep their priority and
// the only cost is a smaller batch.
const MAX_COMPOSITION_HOLD_MS = 10_000
// Head start a due item keeps for the flush → request → response round trip:
// the batch must dispatch this long BEFORE the item's deadline, or the
// translation lands after the content is needed. Only a starting point — the
// queue replaces it with a measured per-provider ETA once it has samples.
const DUE_MARGIN_MS = 3_000
// Floor on the adaptive margin: below this the round trip is assumed to be
// faster than any real provider, which only produces late subtitles.
const MIN_DUE_MARGIN_MS = 2_000
// Ceiling on the adaptive margin: a margin longer than the look-ahead window
// would dispatch every cue the moment it is enqueued.
const MAX_DUE_MARGIN_MS = 30_000
// Weight of the newest sample in the round-trip EWMA: high enough to follow a
// provider that slows down within a few requests, low enough that one outlier
// does not quadruple every margin.
const ROUND_TRIP_EWMA_ALPHA = 0.3
// Multiplier on the measured round trip. Covers the queue wait on top of the
// model call and ordinary variance, without dispatching so early that batches
// stop composing.
const ROUND_TRIP_SAFETY_FACTOR = 1.5

/**
 * Port to the downstream dispatcher (ports & adapters: BatchQueue never learns
 * about RequestQueue). Only batches that reached minItemsPerBatch consult it:
 * while the gate reports no free dispatch slot they keep absorbing arrivals up
 * to maxItems/maxChars — flushing earlier would not start the request any
 * earlier, it would only freeze the batch's composition. Batches below the
 * minimum flush at batchDelay whenever the gate has a slot, and hold for their
 * deadline only while it does not — an idle dispatcher must never be left idle
 * just because a batch is waiting to grow.
 */
export interface DispatchGate {
  /**
   * ms until the downstream dispatcher could start ONE MORE request,
   * accounting for tokens, pauses, and requests already waiting ahead.
   * 0 = a slot is available now.
   */
  nextDispatchEtaMs: () => number
}

interface BatchTask<T, R> {
  data: T
  resolve: (value: R) => void
  reject: (error: Error) => void
  // Same refcounting contract as QueuedRequestTask.cancelScopes: `null` pins
  // the task (an unscoped subscriber exists); otherwise the task is cancelled
  // only when its last scope is cancelled.
  cancelScopes: Set<string> | null
  // Set once the batch has been handed to executeBatch: its scope snapshot is
  // now frozen downstream, so late dedup subscribers must NOT join it (#1881).
  flushed: boolean
}

interface PendingBatch<T, R> {
  id: string
  tasks: BatchTask<T, R>[]
  totalCharacters: number
  createdAt: number
}

export interface BatchExecutionMeta {
  /**
   * Union of the live members' cancellation scopes at flush time, or
   * `undefined` when any member is uncancellable. Thread this into the
   * downstream RequestQueue so cancelling the scopes aborts the whole batch.
   */
  scopes: readonly string[] | undefined
  /**
   * Opaque value produced by `resolveBatchProvider` at flush time (e.g. the
   * provider this batch will be sent to). The queue never interprets it — it
   * just guarantees executeBatch and the per-item fallback observe the SAME
   * value for one flush.
   */
  provider?: unknown
}

export interface BatchOptions<T, R> {
  maxCharactersPerBatch: number
  maxItemsPerBatch: number
  /**
   * Minimum items a batch must accumulate before it may dispatch. At or above
   * this count the batch flushes at the first near dispatch slot — immediately
   * when the limiter is idle; below it, the batch waits until its age reaches
   * batchDelay and is force-flushed then. Clamped to maxItemsPerBatch.
   * 1 = dispatch each arrival on its own.
   */
  minItemsPerBatch?: number
  /**
   * How long a batch stays open to compose arrivals, in ms — the batch
   * dispatches when this window closes (or sooner if it fills up, or when an
   * item's deadline preempts it). Doubles as the below-min force-flush delay
   * and the dispatch-gate tolerance (`etaMs <= batchDelay`). 0 = dispatch each
   * arrival on its own.
   */
  batchDelay: number
  /**
   * Absolute ms timestamp when the item's content is needed (e.g. the cue's
   * playback time). Lets a below-min batch with no dispatch slot to take keep
   * absorbing sparse arrivals until its earliest deadline approaches, instead
   * of force-flushing at batchDelay. Items without a deadline (undefined) fall
   * back to batchDelay.
   */
  getBatchDueAt?: (data: T) => number | undefined
  maxRetries?: number
  enableFallbackToIndividual?: boolean
  dispatchGate?: DispatchGate
  getBatchKey: (data: T) => string
  getCharacters: (data: T) => number
  getDedupKey?: (data: T) => string | undefined
  getScope?: (data: T) => string | undefined
  // Liveness check for a scope whose cancel may have run while a flushed
  // batch was outside every cancellable structure (retry backoff sleep).
  isScopeCancelled?: (scopeKey: string) => boolean
  executeBatch: (dataList: T[], meta: BatchExecutionMeta) => Promise<R[]>
  executeIndividual?: (data: T, meta: BatchExecutionMeta) => Promise<R>
  /**
   * Called once per flush, before executeBatch: lets the owner pick a
   * provider (or any batch-scoped resource) for the WHOLE batch. Items are
   * composed provider-agnostically, so batches can span what would have been
   * separate per-provider groups; the choice lands in `meta.provider` (a
   * Promise here is fine — the owner awaits it inside executeBatch) and is
   * also visible to the per-item fallback.
   */
  resolveBatchProvider?: () => unknown | Promise<unknown>
  onError?: (
    error: Error,
    context: { batchKey: string; retryCount: number; isFallback: boolean },
  ) => void
}

export class BatchQueue<T, R> {
  private pendingBatchMap = new Map<string, PendingBatch<T, R>>()
  private inFlightTasks = new Map<string, { promise: Promise<R>; task: BatchTask<T, R> }>()
  private nextScheduleTimer: NodeJS.Timeout | null = null
  private maxCharactersPerBatch: number
  private maxItemsPerBatch: number
  private minItemsPerBatch: number
  private batchDelay: number
  private getBatchDueAt?: (data: T) => number | undefined
  /**
   * EWMA of the observed flush→response round trip per batchKey (which carries
   * the provider id), used to size the deadline margin. Fixed margins are
   * either too tight for slow models or so loose that every cue dispatches the
   * instant it is enqueued.
   */
  private roundTripEwmaMs = new Map<string, number>()
  private maxRetries: number
  private enableFallbackToIndividual: boolean
  private dispatchGate?: DispatchGate
  private getBatchKey: (data: T) => string
  private getCharacters: (data: T) => number
  private getDedupKey?: (data: T) => string | undefined
  private getScope?: (data: T) => string | undefined
  private isScopeCancelled?: (scopeKey: string) => boolean
  private executeBatch: (dataList: T[], meta: BatchExecutionMeta) => Promise<R[]>
  private executeIndividual?: (data: T, meta: BatchExecutionMeta) => Promise<R>
  private resolveBatchProvider?: () => unknown
  private onError?: (
    error: Error,
    context: { batchKey: string; retryCount: number; isFallback: boolean },
  ) => void

  constructor(config: BatchOptions<T, R>) {
    this.maxCharactersPerBatch = config.maxCharactersPerBatch
    this.maxItemsPerBatch = config.maxItemsPerBatch
    this.minItemsPerBatch = config.minItemsPerBatch ?? 1
    this.batchDelay = config.batchDelay
    this.getBatchDueAt = config.getBatchDueAt
    this.maxRetries = config.maxRetries ?? 3
    this.enableFallbackToIndividual = config.enableFallbackToIndividual ?? true
    this.dispatchGate = config.dispatchGate
    this.getBatchKey = config.getBatchKey
    this.getCharacters = config.getCharacters
    this.getDedupKey = config.getDedupKey
    this.getScope = config.getScope
    this.isScopeCancelled = config.isScopeCancelled
    this.executeBatch = config.executeBatch
    this.executeIndividual = config.executeIndividual
    this.resolveBatchProvider = config.resolveBatchProvider
    this.onError = config.onError
  }

  enqueue(data: T): Promise<R> {
    const scope = this.getScope?.(data)
    const dedupKey = this.getDedupKey?.(data)
    if (dedupKey) {
      const inFlight = this.inFlightTasks.get(dedupKey)
      // Only join a still-pending batch: its cancelScopes set is mutable and
      // its flush-time union will include this scope. A flushed batch has
      // already handed a FROZEN scope snapshot to the RequestQueue, so a late
      // cross-scope subscriber joining it would be cancelled when the original
      // scope cancels — silently dropping this (still-active) session's
      // paragraph. Fall through to a fresh task instead; the RequestQueue's own
      // hash dedup re-coalesces identical batches, so the common case (two tabs
      // on the same page) stays deduped, and at worst one duplicate request is
      // issued for a genuinely different batch (#1881).
      if (inFlight && !inFlight.task.flushed) {
        if (!scope) {
          inFlight.task.cancelScopes = null
        } else if (inFlight.task.cancelScopes !== null) {
          inFlight.task.cancelScopes.add(scope)
        }
        return inFlight.promise
      }
    }

    let resolve!: (value: R) => void
    let reject!: (error: Error) => void
    const promise = new Promise<R>((res, rej) => {
      resolve = res
      reject = rej
    })

    const batchKey = this.getBatchKey(data)
    const task: BatchTask<T, R> = {
      data,
      resolve,
      reject,
      cancelScopes: scope ? new Set([scope]) : null,
      flushed: false,
    }

    if (dedupKey) {
      this.inFlightTasks.set(dedupKey, { promise, task })
      const release = () => {
        if (this.inFlightTasks.get(dedupKey)?.promise === promise) {
          this.inFlightTasks.delete(dedupKey)
        }
      }
      promise.then(release, release)
    }

    this.addTaskToBatch(task, batchKey)
    this.schedule()

    return promise
  }

  /**
   * Cancel every not-yet-flushed member subscribed to the given scope (see
   * RequestQueue.cancelByScope for the refcounting contract). Batches already
   * flushed live as a single RequestQueue task carrying the scope union —
   * cancel them there.
   */
  cancelByScope(scopeKey: string): number {
    return this.cancelWhere((scope) => scope === scopeKey)
  }

  cancelWhere(scopeMatches: (scopeKey: string) => boolean): number {
    let cancelled = 0
    for (const [batchKey, batch] of [...this.pendingBatchMap]) {
      const kept: BatchTask<T, R>[] = []
      for (const task of batch.tasks) {
        const scopes = task.cancelScopes
        if (scopes === null) {
          kept.push(task)
          continue
        }
        let matchedScope: string | undefined
        for (const scope of scopes) {
          if (scopeMatches(scope)) {
            matchedScope = scope
            scopes.delete(scope)
          }
        }
        if (matchedScope === undefined || scopes.size > 0) {
          kept.push(task)
          continue
        }
        // inFlightTasks self-releases via the promise.then(release, release)
        // handler attached at enqueue time.
        task.reject(new TranslationCancelledError(matchedScope))
        cancelled++
      }
      if (kept.length === 0) {
        this.pendingBatchMap.delete(batchKey)
      } else if (kept.length !== batch.tasks.length) {
        batch.tasks = kept
        batch.totalCharacters = kept.reduce((sum, task) => sum + this.getCharacters(task.data), 0)
      }
    }
    if (this.pendingBatchMap.size === 0 && this.nextScheduleTimer) {
      clearTimeout(this.nextScheduleTimer)
      this.nextScheduleTimer = null
    }
    return cancelled
  }

  private schedule() {
    if (this.nextScheduleTimer) {
      clearTimeout(this.nextScheduleTimer)
      this.nextScheduleTimer = null
    }

    const now = Date.now()
    const etaMs = this.dispatchGate?.nextDispatchEtaMs() ?? 0
    // "A dispatch slot is within reach" — the same tolerance the flush test uses.
    const gateHasSlot = etaMs <= this.batchDelay
    const batchesToFlush: string[] = []
    let nextWakeMs = Infinity

    for (const [batchKey, batch] of this.pendingBatchMap.entries()) {
      // Size-full: always flush — the batch's composition is already maximal.
      if (this.shouldFlushBatch(batch)) {
        batchesToFlush.push(batchKey)
        continue
      }

      // Time the batch stops composing and goes, whether because the
      // accumulation window elapsed or because its earliest deadline is closer.
      const underMin = batch.tasks.length < this.effectiveMinItemsPerBatch()
      // A below-min batch may hold past its window for the deadline only while
      // dispatch is contended. With a free slot the hold buys nothing but late
      // subtitles: the request could already be in flight and land inside the
      // look-ahead window instead of at the playhead.
      const holdForComposition = underMin && !gateHasSlot
      const readyAtMs = this.batchReadyAtMs(batchKey, batch, now, holdForComposition)

      if (now >= readyAtMs && (underMin || gateHasSlot)) {
        // Below min the gate is ignored: waiting for a slot would not compose
        // a bigger batch, only delay the one already due. At or above min the
        // batch dispatches at the first near slot — immediately when the
        // limiter is idle. While the gate is backed up, flushing earlier would
        // not start the request any sooner, it would only freeze the batch's
        // composition.
        batchesToFlush.push(batchKey)
        continue
      }

      // When to look again. A batch whose window elapsed waits on the limiter;
      // a batch held for its deadline must additionally wake the moment a slot
      // appears, or it sleeps through exactly the idle capacity that makes
      // prefetching free.
      let wakeMs: number
      if (now >= readyAtMs) {
        wakeMs = Math.min(etaMs - this.batchDelay, MAX_GATE_POLL_MS)
      } else if (holdForComposition) {
        wakeMs = Math.min(readyAtMs - now, Math.max(0, etaMs - this.batchDelay), MAX_GATE_POLL_MS)
      } else {
        // Still composing: wake when the window closes. A deadline closer than
        // the window already shortened readyAtMs above, and new arrivals
        // reschedule sooner on their own.
        wakeMs = readyAtMs - now
      }
      nextWakeMs = Math.min(nextWakeMs, Math.max(wakeMs, 0), MAX_HOLD_WAKE_MS)
    }

    for (const batchKey of batchesToFlush) {
      this.flushPendingBatchByKey(batchKey)
    }

    if (this.pendingBatchMap.size > 0) {
      this.nextScheduleTimer = setTimeout(
        () => {
          this.nextScheduleTimer = null
          this.schedule()
        },
        Number.isFinite(nextWakeMs) ? nextWakeMs : this.batchDelay,
      )
    }
  }

  private addTaskToBatch(task: BatchTask<T, R>, batchKey: string) {
    const characters = this.getCharacters(task.data)
    const existingBatch = this.pendingBatchMap.get(batchKey)

    if (existingBatch) {
      if (existingBatch.totalCharacters + characters <= this.maxCharactersPerBatch) {
        existingBatch.tasks.push(task)
        existingBatch.totalCharacters += characters
      } else {
        this.flushPendingBatchByKey(batchKey)
        this.createNewPendingBatch(task, batchKey)
      }
    } else {
      this.createNewPendingBatch(task, batchKey)
    }
  }

  private shouldFlushBatch(batch: PendingBatch<T, R>): boolean {
    return (
      batch.tasks.length >= this.maxItemsPerBatch ||
      batch.totalCharacters >= this.maxCharactersPerBatch
    )
  }

  // A user (or a racing hot-update) can set min above max; gating can never
  // exceed the batch's own capacity, so clamp instead of holding forever.
  private effectiveMinItemsPerBatch(): number {
    return Math.min(this.minItemsPerBatch, this.maxItemsPerBatch)
  }

  /**
   * The moment a batch stops composing: the batchDelay window closes, or —
   * when an item's deadline is closer — the deadline minus the round-trip
   * margin the batch needs to still land in time.
   *
   * `holdForComposition` (a below-min batch with no dispatch slot to take) is
   * the only case where a far deadline keeps the batch open past its window;
   * everywhere else the deadline can only cut the wait short.
   */
  private batchReadyAtMs(
    batchKey: string,
    batch: PendingBatch<T, R>,
    now: number,
    holdForComposition: boolean,
  ): number {
    const byWindow = batch.createdAt + this.batchDelay
    const dueDispatchMs = this.earliestDueDispatchMs(batchKey, batch)

    if (dueDispatchMs === null) {
      return byWindow
    }
    if (holdForComposition) {
      // Composing past the window is worth at most MAX_COMPOSITION_HOLD_MS of
      // batch age: a far deadline must not pin the batch until playback nears,
      // or the look-ahead prefetch it serves silently never happens while the
      // dispatcher is busy. The window itself still wins if it is longer.
      const holdCapMs = Math.max(byWindow, batch.createdAt + MAX_COMPOSITION_HOLD_MS)
      return Math.min(Math.max(byWindow, dueDispatchMs), holdCapMs)
    }
    // A deadline already in the past must not wait out the window; one inside
    // it shortens the wait to exactly the time left.
    return Math.min(byWindow, Math.max(dueDispatchMs, now))
  }

  /**
   * When the batch's earliest-due item must be dispatched by (its deadline
   * minus the due margin), or null when the queue carries no deadlines — the
   * batch then holds for the accumulation window exactly as before. Computed
   * per schedule() pass: cancellations can remove the earliest item.
   */
  private earliestDueDispatchMs(batchKey: string, batch: PendingBatch<T, R>): number | null {
    if (!this.getBatchDueAt) return null
    const marginMs = this.dueMarginMs(batchKey)
    let earliest = Infinity
    for (const task of batch.tasks) {
      const dueAt = this.getBatchDueAt(task.data)
      if (dueAt !== undefined) {
        earliest = Math.min(earliest, dueAt - marginMs)
      }
    }
    return earliest === Infinity ? null : earliest
  }

  /**
   * How long to reserve for the flush → request → response round trip when
   * deciding when a due item must dispatch. Seeded with a fixed guess and
   * replaced by a 1.5x EWMA of what this batchKey (which carries the provider
   * id) actually took, so a slow model is not dispatched on a fast model's
   * schedule and vice versa.
   */
  private dueMarginMs(batchKey: string): number {
    const ewma = this.roundTripEwmaMs.get(batchKey)
    if (ewma === undefined) {
      return DUE_MARGIN_MS
    }
    const scaled = ewma * ROUND_TRIP_SAFETY_FACTOR
    return Math.min(MAX_DUE_MARGIN_MS, Math.max(MIN_DUE_MARGIN_MS, scaled))
  }

  /** Feed one observed round trip into the per-batchKey EWMA. */
  private recordRoundTrip(batchKey: string, durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return
    }
    const previous = this.roundTripEwmaMs.get(batchKey)
    const next =
      previous === undefined
        ? durationMs
        : previous * (1 - ROUND_TRIP_EWMA_ALPHA) + durationMs * ROUND_TRIP_EWMA_ALPHA
    this.roundTripEwmaMs.set(batchKey, next)
  }

  private createNewPendingBatch(task: BatchTask<T, R>, batchKey: string) {
    const batchId = getRandomUUID()

    const pendingBatch: PendingBatch<T, R> = {
      id: batchId,
      tasks: [task],
      totalCharacters: this.getCharacters(task.data),
      createdAt: Date.now(),
    }

    this.pendingBatchMap.set(batchKey, pendingBatch)
  }

  private flushPendingBatchByKey(batchKey: string) {
    const pendingBatch = this.pendingBatchMap.get(batchKey)
    if (!pendingBatch) return

    this.pendingBatchMap.delete(batchKey)

    const { tasks } = pendingBatch
    // Freeze the batch: from here its downstream scope snapshot is fixed, so
    // enqueue() must stop letting late subscribers dedup into these tasks.
    for (const task of tasks) task.flushed = true

    // Scope union frozen at flush time: if every member is scoped, cancelling
    // all those scopes downstream aborts the whole batch; one unscoped member
    // pins it (scopes: undefined).
    let scopes: string[] | undefined = []
    for (const task of tasks) {
      if (task.cancelScopes === null) {
        scopes = undefined
        break
      }
      scopes.push(...task.cancelScopes)
    }
    const meta: BatchExecutionMeta = { scopes: scopes ? [...new Set(scopes)] : undefined }
    if (this.resolveBatchProvider) {
      meta.provider = this.resolveBatchProvider()
    }

    void this.executeBatchWithRetry(tasks, batchKey, meta, 0)
  }

  private async executeBatchWithRetry(
    tasks: BatchTask<T, R>[],
    batchKey: string,
    meta: BatchExecutionMeta,
    retryCount: number,
  ): Promise<void> {
    // Only the first attempt is a clean sample: retries carry their own backoff
    // sleep, which would inflate the margin they are meant to size.
    const sampleRoundTrip = retryCount === 0
    const startedAt = sampleRoundTrip ? Date.now() : 0

    try {
      const results = await this.executeBatch(
        tasks.map((task) => task.data),
        meta,
      )

      if (sampleRoundTrip) {
        this.recordRoundTrip(batchKey, Date.now() - startedAt)
      }

      if (!results) {
        throw new Error("Batch execution results are undefined")
      }

      if (results.length !== tasks.length) {
        throw new BatchCountMismatchError(tasks.length, results.length, results)
      }

      tasks.forEach((task, index) => task.resolve(results[index]!))
    } catch (error) {
      const err = error as Error

      this.onError?.(err, { batchKey, retryCount, isFallback: false })

      // Only retry on count mismatch errors (LLM returned wrong number of
      // results). A salvageable mismatch skips the retries: identical input
      // reproduces the same merge, so the tail goes straight to fallback.
      if (err instanceof BatchCountMismatchError && err.partialResults) {
        if (this.rejectIfAllScopesCancelled(tasks, meta)) return
        return this.executeFallbackIndividual(tasks, batchKey, meta, err.partialResults)
      }

      if (retryCount < this.maxRetries && err instanceof BatchCountMismatchError) {
        const delay = this.calculateBackoffDelay(retryCount)
        await this.sleep(delay)
        // During the backoff this batch lived in NO cancellable structure
        // (its RequestQueue task already completed, it left pendingBatchMap at
        // flush) — a cancel that arrived meanwhile drained nothing, so re-check
        // scope liveness before burning another provider round trip (#1881).
        if (this.rejectIfAllScopesCancelled(tasks, meta)) return
        return this.executeBatchWithRetry(tasks, batchKey, meta, retryCount + 1)
      }

      if (
        this.enableFallbackToIndividual &&
        this.executeIndividual &&
        err instanceof BatchCountMismatchError
      ) {
        // Same gate before the per-item fallback: the failed attempt's provider
        // call may have straddled the cancel.
        if (this.rejectIfAllScopesCancelled(tasks, meta)) return
        return this.executeFallbackIndividual(tasks, batchKey, meta)
      }

      tasks.forEach((task) => task.reject(err))
    }
  }

  /**
   * When every scope this batch was flushed with has since been cancelled,
   * reject all members with the cancellation error and report true. A batch
   * with an unscoped member (scopes: undefined) or any surviving scope keeps
   * running — same mixed-batch semantics as cancelByScope.
   */
  private rejectIfAllScopesCancelled(tasks: BatchTask<T, R>[], meta: BatchExecutionMeta): boolean {
    if (!this.isScopeCancelled || !meta.scopes || meta.scopes.length === 0) return false
    if (!meta.scopes.every((scope) => this.isScopeCancelled!(scope))) return false
    const error = new TranslationCancelledError(meta.scopes.join(","))
    tasks.forEach((task) => task.reject(error))
    return true
  }

  private async executeFallbackIndividual(
    tasks: BatchTask<T, R>[],
    batchKey: string,
    meta: BatchExecutionMeta,
    partialResults?: unknown[],
  ) {
    await Promise.allSettled(
      tasks.map(async (task, index) => {
        try {
          // Segments the batch response covered (id-aligned) never re-pay a
          // provider round trip; only the merged/dropped tail does.
          const salvaged = partialResults?.[index]
          if (salvaged !== undefined) {
            task.resolve(salvaged as R)
            return
          }
          if (!this.executeIndividual) {
            throw new Error("executeIndividual is not defined")
          }
          const result = await this.executeIndividual(task.data, meta)
          task.resolve(result)
        } catch (error) {
          const err = error as Error
          this.onError?.(err, { batchKey, retryCount: this.maxRetries, isFallback: true })
          task.reject(err)
        }
      }),
    )
  }

  private calculateBackoffDelay(retryCount: number): number {
    return Math.min(BASE_BACKOFF_DELAY_MS * 2 ** retryCount, MAX_BACKOFF_DELAY_MS)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Apply a runtime config patch. `batchDelay` is in MILLISECONDS here — the
   * config/UI layer owns the seconds unit and converts at the wiring boundary,
   * so this class stays unit-agnostic (it must not import the config schema).
   */
  setBatchConfig(
    config: Partial<
      Pick<
        BatchOptions<T, R>,
        "maxCharactersPerBatch" | "maxItemsPerBatch" | "minItemsPerBatch" | "batchDelay"
      >
    >,
  ) {
    this.maxCharactersPerBatch = config.maxCharactersPerBatch ?? this.maxCharactersPerBatch
    this.maxItemsPerBatch = config.maxItemsPerBatch ?? this.maxItemsPerBatch
    this.minItemsPerBatch = config.minItemsPerBatch ?? this.minItemsPerBatch
    this.batchDelay = config.batchDelay ?? this.batchDelay
  }
}
