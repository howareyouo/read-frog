import type { Config } from "@/types/config/config"
import type { TranslationMode } from "@/types/config/translate"
import { translateNodesBilingualMode } from "./modes/bilingual"
import type { ModeRunContext } from "./modes/shared"
import { translateNodeTranslationOnlyMode } from "./modes/translation-only"

export { translateNodesBilingualMode } from "./modes/bilingual"
export { translateNodeTranslationOnlyMode } from "./modes/translation-only"

/**
 * One strategy per page-translation mode. The dispatcher knows nothing about
 * a mode's internals — adding a mode means registering one entry here and
 * shipping the strategy module; the semantic steps the modes share
 * (dedup claim, display folding) live in `./modes/shared`.
 */
export interface TranslationModeStrategy {
  translate(nodes: ChildNode[], walkId: string, ctx: ModeRunContext): Promise<void>
}

const MODE_STRATEGIES: Record<TranslationMode, TranslationModeStrategy> = {
  bilingual: {
    translate: (nodes, walkId, ctx) =>
      translateNodesBilingualMode(
        nodes,
        walkId,
        ctx.config,
        ctx.toggle,
        ctx.forceBlockTranslation,
        ctx.forceRetranslation,
      ),
  },
  translationOnly: {
    translate: (nodes, walkId, ctx) =>
      translateNodeTranslationOnlyMode(nodes, walkId, ctx.config, ctx.toggle, ctx.forceRetranslation),
  },
}

export async function translateNodes(
  nodes: ChildNode[],
  walkId: string,
  toggle: boolean = false,
  config: Config,
  forceBlockTranslation: boolean = false,
  forceRetranslation: boolean = false,
): Promise<void> {
  const strategy = MODE_STRATEGIES[config.pageTranslation.mode]
  if (!strategy) return
  await strategy.translate(nodes, walkId, {
    config,
    toggle,
    forceRetranslation,
    forceBlockTranslation,
  })
}
