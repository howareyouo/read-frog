import { sendMessage } from "@/utils/message"
import type { SerializableProviderRef } from "@/utils/providers/provider-ref"
import type { CachedWebPageContext } from "./webpage-context"

export async function getOrGenerateWebPageSummary(
  webPageContext: CachedWebPageContext | null,
  providerRef: SerializableProviderRef,
  enableAIContentAware: boolean,
): Promise<string | null> {
  if (!enableAIContentAware || !webPageContext) {
    return null
  }

  const { webTitle, webContent } = webPageContext
  if (!webTitle.trim() || !webContent.trim()) {
    return null
  }

  const summary = await sendMessage("getOrGenerateWebPageSummary", {
    webTitle,
    webContent,
    providerRef,
  })

  return summary || null
}
