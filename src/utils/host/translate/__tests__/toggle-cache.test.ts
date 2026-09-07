import { beforeEach, describe, expect, it, vi } from "vitest"
import { sendMessage } from "@/utils/message"
import { clearInMemoryTranslationCache } from "../in-memory-translation-cache"
import { translateTextCore } from "../translate-text"
import { beginPageTranslationSession, endPageTranslationSession } from "../translation-session"

vi.mock("@/utils/message", () => ({ sendMessage: vi.fn() }))
const mockSendMessage = vi.mocked(sendMessage)

const microsoftProvider = {
  provider: "microsoft-translate",
  id: "microsoft",
  enabled: true,
} as never

const langConfig = {
  sourceCode: "eng" as const,
  targetCode: "cmn" as const,
  level: "advanced" as const,
}

function callTranslate(sessionId: string | undefined) {
  return translateTextCore({
    text: "Hello world, this is a paragraph.",
    langConfig,
    providerConfig: microsoftProvider,
    sessionId,
  })
}

describe("toggle original/translated reuses cached translations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearInMemoryTranslationCache()
    mockSendMessage.mockImplementation(async () => "你好世界，这是一段。" as never)
  })

  it("second session (after toggle off/on) hits the in-memory cache", async () => {
    // Session 1: page translated
    const session1 = beginPageTranslationSession()
    const r1 = await callTranslate(session1)
    endPageTranslationSession()
    expect(r1).toBe("你好世界，这是一段。")
    expect(mockSendMessage).toHaveBeenCalledTimes(1)

    // Session 2: user toggled 原文 then 译文 again
    const session2 = beginPageTranslationSession()
    const r2 = await callTranslate(session2)
    endPageTranslationSession()

    // The paragraph was already translated in session 1 — no new request.
    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(r2).toBe("你好世界，这是一段。")
  })
})
