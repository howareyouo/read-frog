// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Config } from "@/types/config/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"

const enqueueCalls: { text: string; hash?: string }[] = []

interface EnqueueTranslateRequestData {
  text: string
  hash?: string
}

vi.mock("@/utils/message", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/message")>()
  return {
    ...actual,
    sendMessage: vi.fn(async (name: string, data: unknown) => {
      if (name === "setAndNotifyPageTranslationStateChangedByManager") return undefined
      if (name === "cancelPageTranslationRequests") return undefined
      if (name === "enqueueTranslateRequest") {
        const { text, hash } = data as EnqueueTranslateRequestData
        enqueueCalls.push({ text, hash })
        return `译文(${text.slice(0, 10)})`
      }
      throw new Error(`unexpected message: ${name}`)
    }),
    onMessage: vi.fn(() => () => {}),
  }
})

const { sendMessage } = await import("@/utils/message")
const mockSendMessage = vi.mocked(sendMessage)

vi.mock("@/utils/config/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/config/storage")>()
  return {
    ...actual,
    getCachedConfig: vi.fn(async () => testConfig),
  }
})

const { getCachedConfig } = await import("@/utils/config/storage")
const mockGetCachedConfig = vi.mocked(getCachedConfig)

const { PageTranslationManager } = await import("../translation-control/page-translation")

const microsoftConfig = {
  ...DEFAULT_CONFIG,
  providersConfig: [
    {
      id: "microsoft",
      enabled: true,
      provider: "microsoft-translate",
      apiKey: "test-key",
    },
  ],
  pageTranslation: {
    ...DEFAULT_CONFIG.pageTranslation,
    providerId: "microsoft",
    providerIds: ["microsoft"],
  },
} as unknown as Config

let testConfig: Config = microsoftConfig

// jsdom has no IntersectionObserver: invoke the callback synchronously on
// observe() so every observed paragraph immediately "enters the viewport".
class FakeIntersectionObserver {
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
  root = null
  rootMargin = ""
  thresholds = []
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver)

function makeParagraph(id: string, text: string) {
  const p = document.createElement("p")
  p.id = id
  p.textContent = text
  return p
}

describe("PageTranslationManager toggle 原文/译文 cache behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enqueueCalls.length = 0
    document.body.innerHTML = ""
    testConfig = microsoftConfig
    mockGetCachedConfig.mockImplementation(async () => testConfig)
  })

  it("toggle off→on does not re-request already translated paragraphs (translationOnly)", async () => {
    testConfig = {
      ...microsoftConfig,
      pageTranslation: {
        ...microsoftConfig.pageTranslation,
        mode: "translationOnly",
      },
    } as unknown as Config

    const p1 = makeParagraph("p1", "Hello world, this is the first paragraph.")
    const p2 = makeParagraph("p2", "Another paragraph with enough words to translate.")
    document.body.append(p1, p2)

    const manager = new PageTranslationManager()
    await manager.start()
    await new Promise((r) => setTimeout(r, 50))
    expect(enqueueCalls.length).toBeGreaterThan(0)

    manager.stop({ userInitiated: true })
    await new Promise((r) => setTimeout(r, 50))
    const afterStopCalls = enqueueCalls.length

    await manager.start()
    await new Promise((r) => setTimeout(r, 200))

    expect(enqueueCalls.length - afterStopCalls).toBe(0)
  })

  it("toggle off→on does not re-request already translated paragraphs (multiple rotating providers)", async () => {
    testConfig = {
      ...microsoftConfig,
      providersConfig: [
        { id: "ms-1", enabled: true, provider: "microsoft-translate", apiKey: "k1" },
        { id: "ms-2", enabled: true, provider: "microsoft-translate", apiKey: "k2" },
      ],
      pageTranslation: {
        ...microsoftConfig.pageTranslation,
        providerId: "ms-1",
        providerIds: ["ms-1", "ms-2"],
      },
    } as unknown as Config

    // Real pages always have a title; the title request participates in the
    // provider rotation and shifts the round-robin parity between runs.
    document.title = "Test Page Title"

    const p1 = makeParagraph("p1", "Hello world, this is the first paragraph.")
    const p2 = makeParagraph("p2", "Another paragraph with enough words to translate.")
    document.body.append(p1, p2)

    const manager = new PageTranslationManager()
    await manager.start()
    await new Promise((r) => setTimeout(r, 50))
    expect(enqueueCalls.length).toBeGreaterThan(0)

    manager.stop({ userInitiated: true })
    await new Promise((r) => setTimeout(r, 50))
    const afterStopCalls = enqueueCalls.length

    await manager.start()
    await new Promise((r) => setTimeout(r, 200))

    expect(enqueueCalls.length - afterStopCalls).toBe(0)
  })

  it("toggle off→on does not re-request already translated paragraphs", async () => {
    const p1 = makeParagraph("p1", "Hello world, this is the first paragraph.")
    const p2 = makeParagraph("p2", "Another paragraph with enough words to translate.")
    document.body.append(p1, p2)

    const manager = new PageTranslationManager()
    await manager.start()

    // Wait for the initial walk + translation to settle
    await new Promise((r) => setTimeout(r, 50))
    const firstRunCalls = enqueueCalls.length
    expect(firstRunCalls).toBeGreaterThan(0)
    expect(mockSendMessage).toHaveBeenCalledWith(
      "enqueueTranslateRequest",
      expect.objectContaining({ text: expect.stringContaining("Hello world") }),
    )

    // Toggle off (show original)
    manager.stop({ userInitiated: true })
    await new Promise((r) => setTimeout(r, 50))
    const afterStopCalls = enqueueCalls.length

    // Toggle on again (show translation)
    await manager.start()
    await new Promise((r) => setTimeout(r, 200))

    const secondRunCalls = enqueueCalls.length - afterStopCalls
    // All paragraphs were already translated in the first run — the in-memory
    // cache must serve them without new enqueueTranslateRequest calls.
    expect(secondRunCalls).toBe(0)
  })
})
