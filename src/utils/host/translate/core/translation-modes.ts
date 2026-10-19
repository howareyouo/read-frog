import type { Config } from "@/types/config/config"
import { translateNodesBilingualMode } from "./modes/bilingual"
import { translateNodeTranslationOnlyMode } from "./modes/translation-only"

export { translateNodesBilingualMode, translateNodeTranslationOnlyMode }

export async function translateNodes(
  nodes: ChildNode[],
  walkId: string,
  toggle: boolean = false,
  config: Config,
  forceBlockTranslation: boolean = false,
  forceRetranslation: boolean = false,
): Promise<void> {
  switch (config.pageTranslation.mode) {
    case "bilingual":
      await translateNodesBilingualMode(
        nodes,
        walkId,
        config,
        toggle,
        forceBlockTranslation,
        forceRetranslation,
      )
      return
    case "translationOnly":
      await translateNodeTranslationOnlyMode(nodes, walkId, config, toggle, forceRetranslation)
      return
  }
}
