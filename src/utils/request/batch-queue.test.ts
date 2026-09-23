import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BatchCountMismatchError, BatchQueue } from "./batch-queue"

describe("BatchQueue minItemsPerBatch gating", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createQueue(
    overrides: Partial<ConstructorParameters<typeof BatchQueue<string, string>>[0]> = {},
  ) {
    const executed: string[][] = []
    const queue = new BatchQueue<string, string>({
      maxCharactersPerBatch: 10_000,
      maxItemsPerBatch: 10,
      batchDelay: 100,
      getBatchKey: () => "same",
      getCharacters: (text) => text.length,
      executeBatch: async (dataList) => {
        executed.push(dataList)
        return dataList
      },
      ...overrides,
    })
    return { queue, executed }
  }

  it("dispatches a min-sized batch when the batchDelay window closes", async () => {
    const { queue, executed } = createQueue({ minItemsPerBatch: 3 })
    const promises = [queue.enqueue("a"), queue.enqueue("b"), queue.enqueue("c")]

    // Reaching minItemsPerBatch does not dispatch on its own — the batch still
    // waits out the batchDelay window to compose more members.
    await vi.advanceTimersByTimeAsync(99)
    expect(executed).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(executed).toEqual([["a", "b", "c"]])
    expect(await Promise.all(promises)).toEqual(["a", "b", "c"])
  })

  it("flushes a below-min batch when it becomes size-full", async () => {
    const { queue, executed } = createQueue({ minItemsPerBatch: 10, maxItemsPerBatch: 2 })
    const promises = [queue.enqueue("a"), queue.enqueue("b")]

    await vi.advanceTimersByTimeAsync(0)
    expect(executed).toEqual([["a", "b"]])
    expect(await Promise.all(promises)).toEqual(["a", "b"])
  })

  it("sends a below-min batch after batchDelay even while the gate is backed up", async () => {
    const { queue, executed } = createQueue({
      minItemsPerBatch: 5,
      dispatchGate: { nextDispatchEtaMs: () => 5_000 },
    })
    const promise = queue.enqueue("a")

    await vi.advanceTimersByTimeAsync(99)
    expect(executed).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(executed).toEqual([["a"]])
    expect(await promise).toBe("a")
  })

  it("holds a satisfied batch while the gate is backed up, then dispatches when a slot nears", async () => {
    let etaMs = 5_000
    const { queue, executed } = createQueue({
      minItemsPerBatch: 2,
      dispatchGate: { nextDispatchEtaMs: () => etaMs },
    })
    const promises = [queue.enqueue("a"), queue.enqueue("b")]

    await vi.advanceTimersByTimeAsync(1_000)
    expect(executed).toEqual([])

    etaMs = 0
    await vi.advanceTimersByTimeAsync(1_000)
    expect(executed).toEqual([["a", "b"]])
    expect(await Promise.all(promises)).toEqual(["a", "b"])
  })

  it("dispatches each arrival on its own when batchDelay is 0", async () => {
    const { queue, executed } = createQueue({ batchDelay: 0 })
    const promise = queue.enqueue("a")

    await vi.advanceTimersByTimeAsync(0)
    expect(executed).toEqual([["a"]])
    expect(await promise).toBe("a")
  })

  it("clamps minItemsPerBatch above maxItemsPerBatch to maxItemsPerBatch", async () => {
    const { queue, executed } = createQueue({ minItemsPerBatch: 99, maxItemsPerBatch: 2 })
    const promises = [queue.enqueue("a"), queue.enqueue("b")]

    await vi.advanceTimersByTimeAsync(0)
    expect(executed).toEqual([["a", "b"]])
    expect(await Promise.all(promises)).toEqual(["a", "b"])
  })
})

describe("BatchQueue dueAt-based holding", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createQueue(
    overrides: Partial<ConstructorParameters<typeof BatchQueue<string, string>>[0]> = {},
  ) {
    const executed: string[][] = []
    const queue = new BatchQueue<string, string>({
      maxCharactersPerBatch: 10_000,
      maxItemsPerBatch: 10,
      batchDelay: 100,
      getBatchKey: () => "same",
      getCharacters: (text) => text.length,
      executeBatch: async (dataList) => {
        executed.push(dataList)
        return dataList
      },
      ...overrides,
    })
    return { queue, executed }
  }

  it("holds a below-min batch past batchDelay, then force-flushes at the composition cap", async () => {
    const dueAt = Date.now() + 20_000
    // The hold only exists while dispatch is contended — see the idle-gate
    // case below.
    const etaMs = 60_000
    const { queue, executed } = createQueue({
      minItemsPerBatch: 3,
      getBatchDueAt: () => dueAt,
      dispatchGate: { nextDispatchEtaMs: () => etaMs },
    })
    const promise = queue.enqueue("a")

    // Composing past the window is capped (MAX_COMPOSITION_HOLD_MS) even though
    // the deadline is minutes out: a look-ahead prefetch must not sit
    // untranslated until playback nears just because the provider is busy.
    await vi.advanceTimersByTimeAsync(9_999)
    expect(executed).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(executed).toEqual([["a"]])
    expect(await promise).toBe("a")
  })

  it("prefetches a below-min batch at batchDelay while the dispatcher is idle", async () => {
    // The look-ahead window exists so cues are translated BEFORE they play. A
    // below-min batch that held until its deadline spent that budget doing
    // nothing while the provider had a free slot — the request only went out
    // as the previous subtitle was ending.
    const dueAt = Date.now() + 20_000
    const { queue, executed } = createQueue({
      minItemsPerBatch: 3,
      getBatchDueAt: () => dueAt,
    })
    const promise = queue.enqueue("a")

    await vi.advanceTimersByTimeAsync(99)
    expect(executed).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(executed).toEqual([["a"]])
    expect(await promise).toBe("a")
  })

  it("dispatches a composition-held batch as soon as a slot frees up", async () => {
    const dueAt = Date.now() + 20_000
    let etaMs = 60_000
    const { queue, executed } = createQueue({
      minItemsPerBatch: 3,
      getBatchDueAt: () => dueAt,
      dispatchGate: { nextDispatchEtaMs: () => etaMs },
    })
    const promise = queue.enqueue("a")

    // Held for composition, but re-polled at the gate-poll interval rather than
    // slept through for the whole remaining lead time.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(executed).toEqual([])

    etaMs = 0
    await vi.advanceTimersByTimeAsync(1_100)
    expect(executed).toEqual([["a"]])
    expect(await promise).toBe("a")
  })

  it("flushes a below-min batch shortly before its earliest item is due", async () => {
    const dueAt = Date.now() + 4_000
    const { queue, executed } = createQueue({
      minItemsPerBatch: 5,
      getBatchDueAt: () => dueAt,
      dispatchGate: { nextDispatchEtaMs: () => 60_000 },
    })
    const promise = queue.enqueue("a")

    // Due at +4000, minus the 3000ms due margin → dispatch at +1000.
    await vi.advanceTimersByTimeAsync(999)
    expect(executed).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(executed).toEqual([["a"]])
    expect(await promise).toBe("a")
  })

  it("does not hold a batch whose due item's deadline has already passed", async () => {
    const dueAt = Date.now() - 1_000
    const { queue, executed } = createQueue({
      minItemsPerBatch: 5,
      getBatchDueAt: () => dueAt,
    })
    const promise = queue.enqueue("a")

    // Overdue: the accumulation window is skipped entirely, not just capped.
    await vi.advanceTimersByTimeAsync(0)
    expect(executed).toEqual([["a"]])
    expect(await promise).toBe("a")
  })

  it("treats items without a dueAt as deadline-less and keeps the batchDelay cap", async () => {
    const dueAt = Date.now() + 60_000
    const { queue, executed } = createQueue({
      minItemsPerBatch: 5,
      getBatchDueAt: (data) => (data === "a" ? undefined : dueAt),
    })
    const promise = queue.enqueue("a")

    await vi.advanceTimersByTimeAsync(99)
    expect(executed).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(executed).toEqual([["a"]])
    expect(await promise).toBe("a")
  })
})

describe("BatchQueue accumulation window", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createQueue(
    overrides: Partial<ConstructorParameters<typeof BatchQueue<string, string>>[0]> = {},
  ) {
    const executed: string[][] = []
    const queue = new BatchQueue<string, string>({
      maxCharactersPerBatch: 10_000,
      maxItemsPerBatch: 4,
      batchDelay: 100,
      getBatchKey: () => "same",
      getCharacters: (text) => text.length,
      executeBatch: async (dataList) => {
        executed.push(dataList)
        return dataList
      },
      ...overrides,
    })
    return { queue, executed }
  }

  it("composes a burst into one request instead of one request per arrival", async () => {
    // Without a window each arrival flushes on its own: the dispatch gate
    // reports a free slot immediately, so maxItemsPerBatch never gets a second
    // member to compose with. This is what a subtitle look-ahead tick hits —
    // every cue in the window becomes its own provider round trip.
    const unwindowed = createQueue({ batchDelay: 0 })
    for (const cue of ["a", "b", "c"]) {
      void unwindowed.queue.enqueue(cue)
      await vi.advanceTimersByTimeAsync(20)
    }
    expect(unwindowed.executed).toEqual([["a"], ["b"], ["c"]])

    const windowed = createQueue({ batchDelay: 300 })
    const promises = ["a", "b", "c"].map((cue) => windowed.queue.enqueue(cue))

    await vi.advanceTimersByTimeAsync(299)
    expect(windowed.executed).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(windowed.executed).toEqual([["a", "b", "c"]])
    expect(await Promise.all(promises)).toEqual(["a", "b", "c"])
  })

  it("flushes a batch that fills up without waiting out the window", async () => {
    const { queue, executed } = createQueue({ batchDelay: 5_000 })
    const promises = ["a", "b", "c", "d"].map((cue) => queue.enqueue(cue))

    // Size-full batches have nothing left to wait for.
    await vi.advanceTimersByTimeAsync(0)
    expect(executed).toEqual([["a", "b", "c", "d"]])
    await Promise.all(promises)
  })

  it("lets a near deadline preempt the accumulation window", async () => {
    const dueAt = Date.now() + 4_000
    const { queue, executed } = createQueue({
      batchDelay: 5_000,
      getBatchDueAt: () => dueAt,
    })
    const promise = queue.enqueue("cue")

    // Due at +4000 minus the 3000ms seed margin → dispatch at +1000, not +5000.
    await vi.advanceTimersByTimeAsync(999)
    expect(executed).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(executed).toEqual([["cue"]])
    expect(await promise).toBe("cue")
  })

  it("sizes the deadline margin from measured round trips", async () => {
    const dueAt = Date.now() + 30_000
    const { queue, executed } = createQueue({
      batchDelay: 500,
      getBatchDueAt: () => dueAt,
      executeBatch: async (dataList) => {
        executed.push(dataList)
        await new Promise((resolve) => setTimeout(resolve, 20_000))
        return dataList
      },
    })

    const first = queue.enqueue("a")
    await vi.advanceTimersByTimeAsync(500)
    expect(executed).toEqual([["a"]])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await first).toBe("a")

    // The 20s round trip was learned (1.5x, clamped to the 30s ceiling), so the
    // next cue with the same 30s lead time is already at its dispatch deadline
    // and skips the window entirely.
    const second = queue.enqueue("b")
    await vi.advanceTimersByTimeAsync(1)
    expect(executed).toEqual([["a"], ["b"]])

    await vi.advanceTimersByTimeAsync(20_000)
    expect(await second).toBe("b")
  })
})

describe("BatchQueue count-mismatch salvage", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createQueue(
    overrides: Partial<ConstructorParameters<typeof BatchQueue<string, string>>[0]> = {},
  ) {
    let batchCalls = 0
    const individualCalls: string[] = []
    const queue = new BatchQueue<string, string>({
      maxCharactersPerBatch: 10_000,
      maxItemsPerBatch: 10,
      batchDelay: 100,
      maxRetries: 3,
      enableFallbackToIndividual: true,
      getBatchKey: () => "same",
      getCharacters: (text) => text.length,
      executeIndividual: async (text) => {
        individualCalls.push(text)
        return `${text}!`
      },
      ...overrides,
      executeBatch:
        overrides.executeBatch ??
        (async () => {
          batchCalls++
          return []
        }),
    })
    return { queue, batchCalls: () => batchCalls, individualCalls }
  }

  it("resolves the salvaged prefix and individually re-requests only the missing tail", async () => {
    const { queue, individualCalls } = createQueue({
      minItemsPerBatch: 3,
      executeBatch: async (dataList) => {
        // Model merged the last two subtitle cues: only seg 0 and seg 1 came back.
        throw new BatchCountMismatchError(dataList.length, 2, ["A", "B"], ["A", "B"])
      },
    })
    const promises = [queue.enqueue("a"), queue.enqueue("b"), queue.enqueue("c")]

    await vi.advanceTimersByTimeAsync(100)
    expect(await Promise.all(promises)).toEqual(["A", "B", "c!"])
    expect(individualCalls).toEqual(["c"])
  })

  it("skips the backoff retries when a salvage exists", async () => {
    let batchCalls = 0
    const queue = new BatchQueue<string, string>({
      maxCharactersPerBatch: 10_000,
      maxItemsPerBatch: 10,
      batchDelay: 100,
      maxRetries: 3,
      getBatchKey: () => "same",
      getCharacters: (text) => text.length,
      executeIndividual: async (text) => text,
      executeBatch: async (dataList) => {
        batchCalls++
        throw new BatchCountMismatchError(dataList.length, 1, ["A"], ["A"])
      },
    })
    const promise = queue.enqueue("a")

    // No retry backoff: once the batchDelay window elapses, the salvage
    // resolves the task without any backoff timers in between.
    await vi.advanceTimersByTimeAsync(100)
    expect(await promise).toBe("A")
    expect(batchCalls).toBe(1)
  })

  it("retries and then falls back for every item when nothing is salvageable", async () => {
    // The counting default executeBatch returns [], which the queue itself
    // turns into a salvage-less BatchCountMismatchError.
    const { queue, batchCalls, individualCalls } = createQueue({ minItemsPerBatch: 2 })
    const promises = [queue.enqueue("a"), queue.enqueue("b")]

    await vi.advanceTimersByTimeAsync(20_000)
    expect(await Promise.all(promises)).toEqual(["a!", "b!"])
    expect(batchCalls()).toBe(4)
    expect(individualCalls).toEqual(["a", "b"])
  })
})

describe("BatchQueue resolveBatchProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves the provider once per flush and hands it to executeBatch", async () => {
    const resolved: unknown[] = []
    const seenMetaProviders: unknown[] = []
    const queue = new BatchQueue<string, string>({
      maxCharactersPerBatch: 10_000,
      maxItemsPerBatch: 10,
      batchDelay: 100,
      getBatchKey: () => "same",
      getCharacters: (text) => text.length,
      resolveBatchProvider: () => {
        const provider = { id: resolved.length }
        resolved.push(provider)
        return provider
      },
      executeBatch: async (dataList, meta) => {
        seenMetaProviders.push(meta.provider)
        return dataList
      },
    })

    const promise = queue.enqueue("a")
    await vi.advanceTimersByTimeAsync(100)
    expect(await promise).toBe("a")
    expect(resolved).toHaveLength(1)
    expect(seenMetaProviders).toEqual([resolved[0]])

    // A second batch resolves its own provider (per-batch rotation).
    const second = queue.enqueue("b")
    await vi.advanceTimersByTimeAsync(100)
    expect(await second).toBe("b")
    expect(resolved).toHaveLength(2)
    expect(seenMetaProviders[1]).toBe(resolved[1])
  })

  it("gives the per-item fallback the same provider the batch was flushed with", async () => {
    const individualMetaProviders: unknown[] = []
    const batchProvider = { id: "batch-provider" }
    const queue = new BatchQueue<string, string>({
      maxCharactersPerBatch: 10_000,
      maxItemsPerBatch: 10,
      batchDelay: 100,
      maxRetries: 0,
      enableFallbackToIndividual: true,
      getBatchKey: () => "same",
      getCharacters: (text) => text.length,
      resolveBatchProvider: () => batchProvider,
      executeBatch: async () => {
        // Count mismatch with no salvage → every item goes to the fallback.
        throw new BatchCountMismatchError(1, 0, [])
      },
      executeIndividual: async (_data, meta) => {
        individualMetaProviders.push(meta.provider)
        return "ok"
      },
    })

    const promise = queue.enqueue("a")
    await vi.advanceTimersByTimeAsync(100)
    expect(await promise).toBe("ok")
    expect(individualMetaProviders).toEqual([batchProvider])
  })
})
