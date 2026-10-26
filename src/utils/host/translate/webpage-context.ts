import type { WebPageContext } from "@/types/content"
import { getDocumentDescription } from "@/utils/content/metadata"
import { extractWebpageReadableText } from "@/utils/content/readable-text"
import { logger } from "@/utils/logger"
import { truncateWebPageContent } from "./webpage-content"

export interface CachedWebPageContext extends WebPageContext {
  url: string
  webContent: string
}

function createWebPageContextCache(extractWebContent: () => string) {
  let cachedWebPageContext: CachedWebPageContext | null = null
  return async function getWebPageContext(): Promise<CachedWebPageContext | null> {
    if (typeof window === "undefined" || typeof document === "undefined") return null

    const currentUrl = window.location.href
    if (cachedWebPageContext?.url === currentUrl) {
      return cachedWebPageContext
    }

    cachedWebPageContext = {
      url: currentUrl,
      webTitle: document.title || "",
      webDescription: getDocumentDescription(document),
      webContent: truncateWebPageContent(extractWebContent()),
    }
    return cachedWebPageContext
  }
}

/**
 * Full webpage context extraction: runs in this content script against the
 * live document (see `extractWebpageReadableText`), stripping nav/ads/footers
 * without any dependency bundle or message round-trip, and falls back to raw
 * body text when nothing readable is found. The result is truncated and cached
 * per URL.
 */
export const getOrCreateWebPageContext = createWebPageContextCache(() => {
  try {
    return extractWebpageReadableText(document) || document.body?.textContent || ""
  } catch (error) {
    logger.warn("Webpage content extraction failed, falling back to body text:", error)
    return document.body?.textContent || ""
  }
})

/**
 * Lightweight webpage context extraction for the selection content script.
 *
 * Uses raw body text instead of the `readable-text` main-content extraction:
 * the context is truncated to 2000 chars anyway, and selection features
 * (selected-text translation prompt context, custom action `{webContent}`
 * token) favor immediate availability. Page translation in host content keeps
 * the full extraction.
 */
export const getLightWebPageContext = createWebPageContextCache(
  () => document.body?.textContent || "",
)
