import type { WebPageContext } from "@/types/content"
import { getDocumentDescription } from "@/utils/content/metadata"
import { truncateWebPageContent } from "./webpage-content"

export interface CachedWebPageContext extends WebPageContext {
  url: string
  webContent: string
}

let cachedWebPageContext: CachedWebPageContext | null = null

/**
 * Lightweight webpage context extraction for the selection content script.
 *
 * Uses raw body text instead of the `readable-text` main-content extraction:
 * the context is truncated to 2000 chars anyway, and selection features
 * (selected-text translation prompt context, custom action `{webContent}`
 * token) favor immediate availability. Page translation in host content keeps
 * the full extraction.
 */
export async function getLightWebPageContext(): Promise<CachedWebPageContext | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null

  const currentUrl = window.location.href
  if (cachedWebPageContext?.url === currentUrl) {
    return cachedWebPageContext
  }

  cachedWebPageContext = {
    url: currentUrl,
    webTitle: document.title || "",
    webDescription: getDocumentDescription(document),
    webContent: truncateWebPageContent(document.body?.textContent || ""),
  }
  return cachedWebPageContext
}
