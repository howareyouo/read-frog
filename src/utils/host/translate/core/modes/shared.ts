import type { Config } from "@/types/config/config"
import { normalizeForComparison } from "../../text-preparation"
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
 * The per-run payload every mode strategy receives from the dispatcher.
 */
export interface ModeRunContext {
  config: Config
  toggle: boolean
  forceRetranslation: boolean
  forceBlockTranslation: boolean
}
