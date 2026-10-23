import type { LangCodeISO6391, LangCodeISO6393 } from "@read-frog/definitions"
import { ISO6393_TO_6391 } from "@read-frog/definitions"
import { browser } from "#imports"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"

interface DetectLanguageResult {
  language: string
  percentage: number
}

/**
 * Chrome's CLD detector reports ISO 639-1 codes (sometimes with region
 * suffixes); the app language codes are ISO 639-3. Invert the definitions
 * table once for the conversion.
 */
const ISO6391_TO_6393: Partial<Record<string, LangCodeISO6393>> = Object.fromEntries(
  Object.entries(ISO6393_TO_6391).flatMap(([iso6393, iso6391]): [string, LangCodeISO6393][] =>
    iso6391 == null ? [] : [[iso6391.toLowerCase(), iso6393 as LangCodeISO6393]],
  ),
)

async function detectIso6393(text: string): Promise<LangCodeISO6393 | "und"> {
  let results: DetectLanguageResult[]
  try {
    results = (await browser.i18n.detectLanguage(text)).languages
  } catch (error) {
    logger.warn("[Background] i18n.detectLanguage failed:", error)
    return "und"
  }

  for (const { language, percentage } of [...results].sort((a, b) => b.percentage - a.percentage)) {
    const lower = language.toLowerCase()
    const matched = ISO6391_TO_6393[lower] ?? ISO6391_TO_6393[lower.split("-")[0]!]
    if (matched) return matched
  }
  return "und"
}

export function setUpLanguageDetectionMessageHandlers() {
  onMessage("detectLanguage", async (message) => detectIso6393(message.data.text))
}
