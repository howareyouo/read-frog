import type { WebPageContext } from "@/types/content"
import { getDocumentDescription } from "@/utils/content/metadata"
import { extractWebpageReadableText } from "@/utils/content/readable-text"
import { logger } from "@/utils/logger"
import { truncateWebPageContent } from "./webpage-content"

export interface CachedWebPageContext extends WebPageContext {
  url: string
  webContent: string
}

let cachedWebPageContext: CachedWebPageContext | null = null

/**
 * Extract the current page's readable content for use as AI prompt context.
 *
 * Extraction runs in this content script against the live document (see
 * `extractWebpageReadableText`), stripping nav/ads/footers without any
 * dependency bundle or message round-trip, and falls back to raw body text
 * when nothing readable is found. The result is truncated and cached per URL.
 */
export async function getOrCreateWebPageContext(): Promise<CachedWebPageContext | null> {
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

function extractWebContent(): string {
  try {
    return extractWebpageReadableText(document) || document.body?.textContent || ""
  } catch (error) {
    logger.warn("Webpage content extraction failed, falling back to body text:", error)
    return document.body?.textContent || ""
  }
}
