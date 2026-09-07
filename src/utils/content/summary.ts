import { logger } from "@/utils/logger"
import { getArticleSummaryPrompt } from "@/utils/prompts/summary"
import type { SerializableProviderRef } from "@/utils/providers/provider-ref"
import { cleanText, MAX_TEXT_LENGTH } from "./utils"

/** The article title is untrusted page text; bound it like the body. */
const MAX_TITLE_LENGTH = 200

/**
 * Generate a brief summary of article content for translation context.
 *
 * The same function serves the page summary and the video summary.
 */
export async function generateArticleSummary(
  title: string,
  textContent: string,
  providerRef: SerializableProviderRef,
  options: {
    signal?: AbortSignal
    generate: (
      payload: {
        providerRef: SerializableProviderRef
        instructions: string
        prompt: string
      },
      runOptions: { signal?: AbortSignal },
    ) => Promise<string>
  },
): Promise<string | null> {
  const preparedText = cleanText(textContent, MAX_TEXT_LENGTH)

  if (!preparedText) {
    return null
  }

  try {
    const { systemPrompt, prompt } = getArticleSummaryPrompt(
      cleanText(title, MAX_TITLE_LENGTH),
      preparedText,
    )

    const summary = await options.generate(
      {
        providerRef,
        instructions: systemPrompt,
        prompt,
      },
      { signal: options.signal },
    )

    const cleanedSummary = summary.trim()
    logger.info("Generated article summary:", `${cleanedSummary.slice(0, 100)}...`)

    return cleanedSummary
  } catch (error) {
    logger.error("Failed to generate article summary:", error)
    return null
  }
}
