// @vitest-environment jsdom
// Characterization suite for core/translation-modes.ts. The 40+ issue patches
// in that file keep ordering invariants alive mostly through comments; these
// tests pin the observable behavior so the mode-strategy refactor (and any
// future edit) can prove it did not change what users see.
//
// Mock surface is intentionally minimal: the provider boundary
// (sendMessage("enqueueTranslateRequest")) and getCachedConfig — everything
// between (filters, HTML attribute protection, alignment, swap, restore,
// state registry) runs for real against jsdom.
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Config } from "@/types/config/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import {
  BLOCK_ATTRIBUTE,
  CONTENT_WRAPPER_CLASS,
  SPINNER_CLASS,
  TRANSLATION_ERROR_CONTAINER_CLASS,
  TRANSLATION_MODE_ATTRIBUTE,
  TRANSLATION_ONLY_ATTRIBUTE,
  WALKED_ATTRIBUTE,
} from "@/utils/constants/dom-labels"

const h = vi.hoisted(() => ({
  translate: (text: string) => `译文(${text})`,
  sentTexts: [] as string[],
  pending: [] as {
    text: string
    resolve: (value: string) => void
    reject: (error: Error) => void
  }[],
  deferred: false,
}))

vi.mock("@/utils/message", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/message")>()
  return {
    ...actual,
    sendMessage: vi.fn(async (name: string, data: unknown) => {
      if (name !== "enqueueTranslateRequest") return undefined
      const { text } = data as { text: string }
      h.sentTexts.push(text)
      if (h.deferred) {
        return new Promise<string>((resolve, reject) => {
          h.pending.push({ text, resolve, reject })
        })
      }
      return h.translate(text)
    }),
    onMessage: vi.fn(() => () => {}),
  }
})

vi.mock("@/utils/config/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/config/storage")>()
  return {
    ...actual,
    getCachedConfig: vi.fn(async () => testConfig),
  }
})

const SOURCE = "Hello world, this is the first paragraph."

function makeConfig(): Config {
  return {
    ...DEFAULT_CONFIG,
    providersConfig: [
      { id: "microsoft", enabled: true, provider: "microsoft-translate", apiKey: "test-key" },
    ],
    pageTranslation: {
      ...DEFAULT_CONFIG.pageTranslation,
      providers: ["microsoft"],
      enableTargetLanguageSkip: false,
    },
  } as unknown as Config
}

let testConfig: Config

const { translateNodesBilingualMode, translateNodeTranslationOnlyMode } = await import(
  "../translation-modes"
)
const {
  getBilingualTranslationStateForSource,
  getTranslationOnlyAnchorState,
  MAX_WRAPPER_TAMPER_REPAIRS,
} = await import("../translation-state")

/** Mirrors what walkAndLabelElement does before the translate pipeline runs. */
function makeBlockParagraph(text: string): HTMLParagraphElement {
  const p = document.createElement("p")
  p.setAttribute(BLOCK_ATTRIBUTE, "")
  p.textContent = text
  document.body.appendChild(p)
  return p
}

function makePreWrapContainer(text: string): HTMLDivElement {
  const div = document.createElement("div")
  div.setAttribute(BLOCK_ATTRIBUTE, "")
  div.style.whiteSpace = "pre-wrap"
  div.textContent = text
  document.body.appendChild(div)
  return div
}

/** Drains the DOMBatcher queue (requestAnimationFrame-based). */
const flushBatch = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })

async function waitForPendingRequests(count: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (h.pending.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Expected ${count} pending provider requests, got ${h.pending.length}`)
}

function resolveAllPending(): void {
  for (const request of h.pending.splice(0)) {
    request.resolve(h.translate(request.text))
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.translate = (text: string) => `译文(${text})`
  h.sentTexts.length = 0
  h.pending.length = 0
  h.deferred = false
  testConfig = makeConfig()
  document.body.innerHTML = ""
})

describe("translateNodesBilingualMode", () => {
  it("appends a bilingual wrapper holding the translation after a block source", async () => {
    const p = makeBlockParagraph(SOURCE)

    await translateNodesBilingualMode([p], "walk-1", testConfig)
    await flushBatch()

    const wrapper = p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)
    expect(wrapper).not.toBeNull()
    expect(wrapper!.getAttribute(TRANSLATION_MODE_ATTRIBUTE)).toBe("bilingual")
    expect(wrapper!.getAttribute(WALKED_ATTRIBUTE)).toBe("walk-1")
    expect(wrapper!.querySelector(`.${SPINNER_CLASS}`)).toBeNull()
    expect(wrapper!.textContent).toBe(`译文(${SOURCE})`)
    // Bilingual: the source text stays in place next to the translation.
    expect(p.textContent).toContain(SOURCE)
    expect(h.sentTexts).toEqual([SOURCE])
  })

  it("toggle removes the wrapper and shows the original without a new request", async () => {
    const p = makeBlockParagraph(SOURCE)
    await translateNodesBilingualMode([p], "walk-1", testConfig)
    await flushBatch()
    expect(p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).not.toBeNull()

    await translateNodesBilingualMode([p], "walk-2", testConfig, true)

    expect(p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
    expect(p.textContent).toBe(SOURCE)
    expect(h.sentTexts).toEqual([SOURCE])
  })

  it("retranslates on a fresh walk, replacing the old wrapper", async () => {
    const p = makeBlockParagraph(SOURCE)
    await translateNodesBilingualMode([p], "walk-1", testConfig)
    await flushBatch()
    const firstWrapper = p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)

    await translateNodesBilingualMode([p], "walk-2", testConfig)
    await flushBatch()

    expect(h.sentTexts).toEqual([SOURCE, SOURCE])
    const secondWrapper = p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)
    expect(secondWrapper).not.toBeNull()
    expect(secondWrapper).not.toBe(firstWrapper)
    expect(secondWrapper!.getAttribute(WALKED_ATTRIBUTE)).toBe("walk-2")
    expect(secondWrapper!.textContent).toBe(`译文(${SOURCE})`)
  })

  it(`repairs site-rewritten wrapper content up to the budget, then adopts the site's version (#1918)`, async () => {
    const p = makeBlockParagraph(SOURCE)
    await translateNodesBilingualMode([p], "walk-1", testConfig)
    await flushBatch()
    let wrapper = p.querySelector(`.${CONTENT_WRAPPER_CLASS}`) as HTMLElement

    for (let i = 1; i <= MAX_WRAPPER_TAMPER_REPAIRS; i += 1) {
      wrapper.textContent = `SITE-REWRITE-${i}`
      await translateNodesBilingualMode([p], `walk-${i + 1}`, testConfig)
      await flushBatch()

      const repaired = p.querySelector(`.${CONTENT_WRAPPER_CLASS}`) as HTMLElement
      expect(repaired).not.toBe(wrapper)
      expect(repaired.textContent).toBe(`译文(${SOURCE})`)
      wrapper = repaired
    }
    expect(h.sentTexts).toHaveLength(MAX_WRAPPER_TAMPER_REPAIRS + 1)

    // Budget exhausted: no further repair fight and no request — the site's
    // content is adopted as the expected wrapper content.
    wrapper.textContent = "SITE-REWRITE-FINAL"
    await translateNodesBilingualMode([p], `walk-${MAX_WRAPPER_TAMPER_REPAIRS + 2}`, testConfig)
    await flushBatch()

    expect(p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBe(wrapper)
    expect(wrapper.textContent).toBe("SITE-REWRITE-FINAL")
    expect(h.sentTexts).toHaveLength(MAX_WRAPPER_TAMPER_REPAIRS + 1)
    expect(getBilingualTranslationStateForSource(p)?.wrapperTextContent).toBe("SITE-REWRITE-FINAL")
  })

  it("lets a concurrent second walk take over with exactly one provider request", async () => {
    const p = makeBlockParagraph(SOURCE)

    await Promise.all([
      translateNodesBilingualMode([p], "walk-A", testConfig),
      translateNodesBilingualMode([p], "walk-B", testConfig),
    ])
    await flushBatch()

    expect(h.sentTexts).toHaveLength(1)
    const wrapper = p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)
    expect(wrapper).not.toBeNull()
    expect(wrapper!.getAttribute(WALKED_ATTRIBUTE)).toBe("walk-B")
  })

  it("drops the response when the wrapper is removed mid-flight (stale-run guard)", async () => {
    h.deferred = true
    const p = makeBlockParagraph(SOURCE)
    const pipeline = translateNodesBilingualMode([p], "walk-1", testConfig)
    await waitForPendingRequests(1)
    await flushBatch()

    p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)!.remove()
    resolveAllPending()
    await pipeline
    await flushBatch()

    expect(p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
    expect(p.textContent).toBe(SOURCE)
    expect(getBilingualTranslationStateForSource(p)).toBeUndefined()
    expect(h.sentTexts).toHaveLength(1)
  })

  it("hides a translation identical to its source (#1832/#1835)", async () => {
    h.translate = (text) => text
    const p = makeBlockParagraph(SOURCE)

    await translateNodesBilingualMode([p], "walk-1", testConfig)
    await flushBatch()

    expect(p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
    expect(p.textContent).toBe(SOURCE)
    expect(h.sentTexts).toHaveLength(1)
  })

  it("keeps the wrapper with the error UI when the provider fails", async () => {
    h.translate = () => {
      throw new Error("provider down")
    }
    const p = makeBlockParagraph(SOURCE)

    await translateNodesBilingualMode([p], "walk-1", testConfig)
    await flushBatch()

    const wrapper = p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)
    expect(wrapper).not.toBeNull()
    expect(wrapper!.querySelector(`.${TRANSLATION_ERROR_CONTAINER_CLASS}`)).not.toBeNull()
  })
})

describe("translateNodeTranslationOnlyMode", () => {
  it("swaps the translation into the site's own text node and marks the anchor", async () => {
    const p = makeBlockParagraph(SOURCE)
    const textNode = p.firstChild as Text

    await translateNodeTranslationOnlyMode([p], "walk-1", testConfig)
    await flushBatch()

    expect(textNode.data).toBe(`译文(${SOURCE})`)
    expect(p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
    expect(p.hasAttribute(TRANSLATION_ONLY_ATTRIBUTE)).toBe(true)
    const state = getTranslationOnlyAnchorState(p)
    expect(state?.swaps).toHaveLength(1)
    expect(state?.swaps[0]!.items[0]!.node).toBe(textNode)
    expect(state?.swaps[0]!.items[0]!.originalValue).toBe(SOURCE)
    expect(h.sentTexts).toEqual([SOURCE])
  })

  it("toggle restores the SAME Text node object and clears the anchor (#1846)", async () => {
    const p = makeBlockParagraph(SOURCE)
    const textNode = p.firstChild as Text
    await translateNodeTranslationOnlyMode([p], "walk-1", testConfig)
    await flushBatch()

    await translateNodeTranslationOnlyMode([p], "walk-2", testConfig, true)

    expect(textNode.data).toBe(SOURCE)
    expect(p.firstChild).toBe(textNode)
    expect(p.childNodes).toHaveLength(1)
    expect(p.hasAttribute(TRANSLATION_ONLY_ATTRIBUTE)).toBe(false)
    expect(p.hasAttribute("dir")).toBe(false)
    expect(p.hasAttribute("lang")).toBe(false)
    expect(getTranslationOnlyAnchorState(p)).toBeUndefined()
    expect(h.sentTexts).toEqual([SOURCE])
  })

  it("restores the swap before snapshotting, so the retranslation request carries the original text", async () => {
    const p = makeBlockParagraph(SOURCE)
    const textNode = p.firstChild as Text
    await translateNodeTranslationOnlyMode([p], "walk-1", testConfig)
    await flushBatch()
    h.translate = (text) => (h.sentTexts.length >= 2 ? `第二轮(${text})` : `第一轮(${text})`)

    await translateNodeTranslationOnlyMode([p], "walk-2", testConfig, false, true)
    await flushBatch()

    // The second request must contain the ORIGINAL text: restore-first runs
    // before the snapshot and the provider round trip.
    expect(h.sentTexts).toEqual([SOURCE, SOURCE])
    expect(textNode.data).toBe(`第二轮(${SOURCE})`)
    const state = getTranslationOnlyAnchorState(p)
    expect(state?.swaps).toHaveLength(1)
    expect(state?.swaps[0]!.walkId).toBe("walk-2")
  })

  it("drops the response when the host rewrites the text mid-flight (source snapshot guard)", async () => {
    h.deferred = true
    const p = makeBlockParagraph(SOURCE)
    const pipeline = translateNodeTranslationOnlyMode([p], "walk-1", testConfig)
    await waitForPendingRequests(1)
    await flushBatch()

    const rewritten = "The host rewrote this text while the request was in flight."
    ;(p.firstChild as Text).data = rewritten
    resolveAllPending()
    await pipeline
    await flushBatch()

    expect((p.firstChild as Text).data).toBe(rewritten)
    expect(p.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
    expect(p.hasAttribute(TRANSLATION_ONLY_ATTRIBUTE)).toBe(false)
    expect(getTranslationOnlyAnchorState(p)).toBeUndefined()
    expect(h.sentTexts).toHaveLength(1)
  })

  it("segments a pre-wrap container into per-unit runs and swaps each", async () => {
    const div = makePreWrapContainer("First paragraph text\n\nSecond paragraph text")

    await translateNodeTranslationOnlyMode([div], "walk-1", testConfig)
    await flushBatch()

    expect(h.sentTexts).toEqual(["First paragraph text", "Second paragraph text"])
    expect(div.textContent).toBe(`译文(First paragraph text)\n\n译文(Second paragraph text)`)
    expect(div.childNodes).toHaveLength(3)
    expect(div.hasAttribute(TRANSLATION_ONLY_ATTRIBUTE)).toBe(true)
    // Each unit keeps its own restore record on the shared container anchor —
    // a sibling unit's swap must not replace it.
    const state = getTranslationOnlyAnchorState(div)
    expect(state?.swaps).toHaveLength(2)
    expect(state?.swaps[0]!.items[0]!.node).toBe(div.childNodes[0])
    expect(state?.swaps[1]!.items[0]!.node).toBe(div.childNodes[2])

    await translateNodeTranslationOnlyMode([div], "walk-2", testConfig, true)

    expect(div.textContent).toBe("First paragraph text\n\nSecond paragraph text")
    expect(div.childNodes).toHaveLength(1)
    expect(div.firstChild!.nodeType).toBe(Node.TEXT_NODE)
    expect(div.hasAttribute(TRANSLATION_ONLY_ATTRIBUTE)).toBe(false)
    expect(getTranslationOnlyAnchorState(div)).toBeUndefined()
  })

  it("rejoins the cuts and removes the marker when every unit is filtered (leftNoTrace)", async () => {
    const div = makePreWrapContainer("12345\n\n67890")

    await translateNodeTranslationOnlyMode([div], "walk-1", testConfig)
    await flushBatch()

    expect(h.sentTexts).toHaveLength(0)
    expect(div.textContent).toBe("12345\n\n67890")
    expect(div.childNodes).toHaveLength(1)
    expect(div.firstChild!.nodeType).toBe(Node.TEXT_NODE)
    expect(div.hasAttribute(TRANSLATION_ONLY_ATTRIBUTE)).toBe(false)
    expect(getTranslationOnlyAnchorState(div)).toBeUndefined()
  })

  it("a mid-flight toggle tears the generation down; in-flight unit responses never land", async () => {
    h.deferred = true
    const div = makePreWrapContainer("First paragraph text\n\nSecond paragraph text")
    const first = translateNodeTranslationOnlyMode([div], "walk-1", testConfig)
    await waitForPendingRequests(2)
    await flushBatch()

    await translateNodeTranslationOnlyMode([div], "walk-2", testConfig, true)
    resolveAllPending()
    await first
    await flushBatch()

    expect(div.textContent).toBe("First paragraph text\n\nSecond paragraph text")
    expect(div.childNodes).toHaveLength(1)
    expect(div.querySelector(`.${CONTENT_WRAPPER_CLASS}`)).toBeNull()
    expect(div.hasAttribute(TRANSLATION_ONLY_ATTRIBUTE)).toBe(false)
    expect(getTranslationOnlyAnchorState(div)).toBeUndefined()
    expect(h.sentTexts).toEqual(["First paragraph text", "Second paragraph text"])
  })
})
