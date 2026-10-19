import { describe, expect, it } from "vitest"
import type { Config } from "@/types/config/config"
import { buildTranslationBatchKey } from "./translation-queues"

const langConfig = { sourceCode: "eng", targetCode: "cmn" } as unknown as Config["language"]

const context = {
  webTitle: "Some article",
  webDescription: "",
  webContent: "Body text of the article",
  webSummary: undefined,
}

// Page translation resolves one provider per paragraph in round-robin, so two
// paragraphs of the same page routinely carry different provider refs.
const item = (providerId: string) => ({
  langConfig,
  context,
  provider: { kind: "local" as const, config: { id: providerId } },
})

describe("buildTranslationBatchKey", () => {
  it("keeps a page's paragraphs in one bucket across the provider rotation", () => {
    // The bug this guards: a provider-scoped key put consecutive paragraphs of
    // one page in different buckets, so with minItemsPerBatch above 1 no bucket
    // ever reached the floor and every paragraph shipped as its own request.
    expect(buildTranslationBatchKey(item("provider-a"))).toBe(
      buildTranslationBatchKey(item("provider-b")),
    )
  })

  it("still separates different language pairs and different prompt contexts", () => {
    const base = buildTranslationBatchKey(item("provider-a"))

    expect(
      buildTranslationBatchKey({
        ...item("provider-a"),
        langConfig: { sourceCode: "eng", targetCode: "jpn" } as unknown as Config["language"],
      }),
    ).not.toBe(base)

    expect(
      buildTranslationBatchKey({
        ...item("provider-a"),
        context: { ...context, webTitle: "Another" },
      }),
    ).not.toBe(base)

    expect(buildTranslationBatchKey({ ...item("provider-a"), context: undefined })).not.toBe(base)
  })
})
