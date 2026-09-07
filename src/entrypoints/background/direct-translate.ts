import type { Config } from "@/types/config/config"
import { executeTranslate } from "@/utils/host/translate/execute-translate"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import { getTranslatePrompt } from "@/utils/prompts/translate"

/**
 * The unified translation network exit for callers outside the main queues:
 * the translation hub and the options connection test. They previously called
 * executeTranslate in their own page contexts, which issued provider requests
 * from three different extension contexts and dragged the AI SDK (every
 * @ai-sdk/* factory is a static import of executeTranslate's graph) into each
 * page bundle. Routing through this handler keeps the background service
 * worker the only context that issues translation requests, at the cost of no
 * queueing — intentional: these are one-off, user-initiated requests that must
 * not wait behind (or share rate-limit budget with) page translation traffic.
 */
export function setUpDirectTranslate() {
  onMessage("directTranslate", async (message) => {
    const { text, langConfig, providerConfig, textFormat, preserveLineBreaks } = message.data
    logger.info("[DirectTranslate] request", {
      provider: providerConfig.provider,
      chars: text.length,
    })

    const result = await executeTranslate(text, langConfig, providerConfig, getTranslatePrompt, {
      textFormat,
      preserveLineBreaks,
      // Pinned: a connection test must report on the key/model the user is
      // looking at, and a hub translation on the config it was sent with — not
      // on whichever extra key or rotation model happens to be next.
      credentials: "pinned",
    })

    logger.info("[DirectTranslate] done", { provider: providerConfig.provider })
    return result
  })
}
