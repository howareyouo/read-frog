import type { LangCodeISO6393 } from "@read-frog/definitions"
import { ISO6393_TO_6391 } from "@read-frog/definitions"
import type { Config } from "@/types/config/config"
import { getDetectedCodeFromStorage, getFinalSourceCode } from "@/utils/config/languages"
import { getEffectiveSiteRule } from "@/utils/site-rules/effective"
import { memoizePromise } from "@/utils/utils"

const PURE_HANDLE_RE = /^@\S+$/u

// Intl.Segmenter construction is expensive (especially for CJK/Japanese
// locales) and the locale set is tiny, so build one per locale and reuse it.
const segmenterCache = new Map<string, Intl.Segmenter>()

function getSegmenter(locale: string): Intl.Segmenter {
  let segmenter = segmenterCache.get(locale)
  if (!segmenter) {
    segmenter = new Intl.Segmenter(locale, { granularity: "word" })
    segmenterCache.set(locale, segmenter)
  }
  return segmenter
}

// The detected source code is stable for the lifetime of a page; memoize the
// (async) storage read instead of paying it on every paragraph this filter
// runs on (it is called once per virtual/bilingual/translationOnly run).
const getDetectedCodeFromStorageCached = memoizePromise(getDetectedCodeFromStorage)

async function getFinalSourceCodeCached(
  configSourceCode: LangCodeISO6393 | "auto",
): Promise<LangCodeISO6393> {
  const detectedCode = await getDetectedCodeFromStorageCached()
  return getFinalSourceCode(configSourceCode, detectedCode)
}

function countWords(text: string, sourceCode: LangCodeISO6393, minWords: number): number {
  // Convert ISO 639-3 (e.g., 'eng') to ISO 639-1 (e.g., 'en') for Intl.Segmenter
  const locale = ISO6393_TO_6391[sourceCode] ?? "en"
  const segmenter = getSegmenter(locale)
  let count = 0
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) {
      count += 1
      // Stop as soon as we know the paragraph is big enough — no need to
      // materialize the whole segmented array.
      if (count >= minWords) return count
    }
  }
  return count
}

export async function shouldFilterSmallParagraph(text: string, config: Config): Promise<boolean> {
  if (PURE_HANDLE_RE.test(text.trim())) return true

  const siteRule = getEffectiveSiteRule(config, window.location.href)
  const minCharactersPerNode =
    siteRule.minCharacters ?? config.pageTranslation.page.minCharactersPerNode
  const minWordsPerNode = siteRule.minWords ?? config.pageTranslation.page.minWordsPerNode
  const { sourceCode } = config.language

  if (minCharactersPerNode > 0 && text.length < minCharactersPerNode) return true

  if (minWordsPerNode > 0) {
    const finalSourceCode = await getFinalSourceCodeCached(sourceCode)
    if (countWords(text, finalSourceCode, minWordsPerNode) < minWordsPerNode) return true
  }

  return false
}
