import type { Config } from "@/types/config/config"
import type { TranslationMode } from "@/types/config/translate"
import {
  CONTENT_WRAPPER_CLASS,
  NOTRANSLATE_CLASS,
  TRANSLATION_MODE_ATTRIBUTE,
  VIRTUAL_PARAGRAPH_ATTRIBUTE,
  WALKED_ATTRIBUTE,
} from "../../../../constants/dom-labels"
import { shouldFilterSmallParagraph } from "../../filter-small-paragraph"
import { normalizeForComparison } from "../../text-preparation"
import { shouldSkipAsTargetLanguage } from "../../target-language-skip"
import { setTranslationDirAndLang } from "../../translation-attributes"
import { createSpinnerInside } from "../../ui/spinner"
import { translatingNodes } from "../translation-state"

/**
 * Dedup guard shared by both mode pipelines: `false` when every node is
 * already being translated by an in-flight run (the caller must return),
 * otherwise claims the nodes — release them in a `finally` via
 * `releaseNodesFromTranslation`.
 */
export function claimNodesForTranslation(nodes: ChildNode[]): boolean {
  if (nodes.every((node) => translatingNodes.has(node))) {
    return false
  }
  nodes.forEach((node) => {
    translatingNodes.add(node)
  })
  return true
}

export function releaseNodesFromTranslation(nodes: ChildNode[]): void {
  nodes.forEach((node) => {
    translatingNodes.delete(node)
  })
}

export function getDisplayTranslation(
  sourceText: string,
  translatedText: string | undefined,
  comparisonText: string | undefined = translatedText,
) {
  if (translatedText === undefined) {
    return undefined
  }

  // comparisonText lets the HTML-marker path (#1832) compare a normalized
  // variant while the raw translatedText is what gets displayed; the folding
  // normalization (#1835) applies on top for both paths.
  return normalizeForComparison(sourceText) === normalizeForComparison(comparisonText)
    ? ""
    : translatedText
}

/**
 * Paragraph gate shared by both modes: the compact-paragraph heuristic, then
 * target-language skip — short-circuited, so same-language text never reaches
 * the second check.
 */
export async function isParagraphFilteredOut(text: string, config: Config): Promise<boolean> {
  return (
    (await shouldFilterSmallParagraph(text, config)) ||
    (await shouldSkipAsTargetLanguage(text, config))
  )
}

/**
 * The span wrapper + spinner both modes insert before their provider
 * round-trip: the wrapper is the spinner vehicle and afterwards the translation
 * container (bilingual) or the swap fallback (translationOnly).
 */
export function createModeWrapper(
  ownerDoc: Document,
  walkId: string,
  mode: TranslationMode,
  config: Config,
  options: { virtualParagraphId?: string; style?: Partial<CSSStyleDeclaration> } = {},
): { spinner: HTMLElement; wrapper: HTMLElement } {
  const wrapper = ownerDoc.createElement("span")
  wrapper.className = `${NOTRANSLATE_CLASS} ${CONTENT_WRAPPER_CLASS}`
  wrapper.setAttribute(TRANSLATION_MODE_ATTRIBUTE, mode)
  wrapper.setAttribute(WALKED_ATTRIBUTE, walkId)
  if (options.virtualParagraphId) {
    wrapper.setAttribute(VIRTUAL_PARAGRAPH_ATTRIBUTE, options.virtualParagraphId)
  }
  if (options.style) {
    Object.assign(wrapper.style, options.style)
  }
  setTranslationDirAndLang(wrapper, config)
  return { spinner: createSpinnerInside(wrapper), wrapper }
}
