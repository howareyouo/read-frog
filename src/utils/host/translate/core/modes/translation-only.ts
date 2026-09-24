import type { Config } from "@/types/config/config"
import type { TranslationMode } from "@/types/config/translate"
import type { TransNode } from "@/types/dom"
import { logger } from "@/utils/logger"
import {
  CONTENT_WRAPPER_CLASS,
  NOTRANSLATE_CLASS,
  PARAGRAPH_ATTRIBUTE,
  TRANSLATION_MODE_ATTRIBUTE,
  TRANSLATION_ONLY_ATTRIBUTE,
  WALKED_ATTRIBUTE,
} from "../../../../constants/dom-labels"
import { batchDOMOperation } from "../../../dom/batch-dom"
import { isBlockTransNode, isHTMLElement, isTextNode, isTransNode } from "../../../dom/filter"
import { unwrapDeepestOnlyHTMLChild } from "../../../dom/find"
import { getOwnerDocument } from "../../../dom/node"
import { canSplitGiantWithoutStrandingOwnText, extractTextContent } from "../../../dom/traversal"
import {
  acquireDeepLXHtmlAttributeProbe,
  type DeepLXHtmlAttributeProbe,
  finishDeepLXHtmlAttributeProbe,
  getDeepLXHtmlAttributeProviderKey,
  supportedDeepLXHtmlAttributeProviders,
  unsupportedDeepLXHtmlAttributeProviders,
} from "../../deeplx-html-capability"
import {
  buildVirtualParagraphPlan,
  canMaterializeVirtualParagraphUnits,
  isGiantParagraphUnit,
} from "../../dom/paragraph-segmentation"
import {
  dropTranslationOnlySwapRecordsForNodes,
  removeTranslatedWrapperWithRestore,
  restoreTranslationOnlySwapsForAnchor,
  teardownVirtualTranslationOnlyGeneration,
} from "../../dom/translation-cleanup"
import { protectTranslationHtmlAttributes } from "../../dom/translation-html-attributes"
import {
  applyInPlaceTextSwap,
  ensureTranslationOnlyAnchorState,
  planInPlaceTextSwap,
  snapshotSourceTextNodes,
  verifySourceSnapshot,
} from "../../dom/translation-text-swap"
import { materializeVirtualParagraphUnitRuns } from "../../dom/virtual-paragraph-insertion"
import { shouldFilterSmallParagraph } from "../../filter-small-paragraph"
import { isHtmlAttributeMarkerIntegrityError } from "../../html-attribute-markers"
import { shouldSkipAsTargetLanguage } from "../../target-language-skip"
import { translateTextForPage } from "../../translate-variants"
import { setTranslationDirAndLang } from "../../translation-attributes"
import { createSpinnerInside, getTranslatedTextAndRemoveSpinner } from "../../ui/spinner"
import { isNumericContent } from "../../ui/translation-utils"
import {
  getTranslationOnlyAnchorState,
  markExtensionDrivenNodeRemoval,
  registerTranslationOnlyOriginals,
} from "../translation-state"
import {
  claimNodesForTranslation,
  getDisplayTranslation,
  releaseNodesFromTranslation,
} from "./shared"

let virtualTranslationOnlyGenerationSequence = 0

function translateTextForAction(
  text: string,
  textFormat: "plain" | "html",
  forceRetranslation: boolean = false,
): Promise<string> {
  return translateTextForPage(text, textFormat, { forceRetranslation })
}

/**
 * A run's own translationOnly wrapper, scoped to the run: the insertion code
 * only ever places the wrapper as a sibling within the run or appends it into
 * a single-element run, so nested runs' wrappers (a li's inside this run's
 * subtree) are out of reach by construction.
 */
function findRunTranslationOnlyWrapper(
  allChildNodes: ChildNode[],
  walkId: string,
): HTMLElement | null {
  // Any-mode wrapper: a bilingual wrapper here is this run's own previous
  // translation too (node-level translate, then a mode switch, then toggle).
  const isForeignWrapper = (element: HTMLElement) =>
    element.classList.contains(CONTENT_WRAPPER_CLASS) &&
    element.getAttribute(WALKED_ATTRIBUTE) !== walkId

  for (const node of allChildNodes) {
    if (!isHTMLElement(node)) continue
    if (isForeignWrapper(node)) return node
    // Spinner phase of a single-element run: wrapper appended INSIDE it
    for (const child of node.children) {
      if (isHTMLElement(child) && isForeignWrapper(child)) return child
    }
  }
  return null
}

/**
 * Entry point for translationOnly mode. Picks the granularity — one run for
 * the whole request, or one run per blank-line paragraph — and leaves the
 * translating to `translateTranslationOnlyRun`.
 */
export async function translateNodeTranslationOnlyMode(
  nodes: ChildNode[],
  walkId: string,
  config: Config,
  toggle: boolean = false,
  forceRetranslation: boolean = false,
): Promise<void> {
  const outerTransNodes = nodes.filter(isTransNode)
  if (outerTransNodes.length === 0) return

  const layoutSource = outerTransNodes[0]!
  const isSingleBlockSource =
    outerTransNodes.length === 1 && isHTMLElement(layoutSource) && isBlockTransNode(layoutSource)
  if (isSingleBlockSource) {
    const handled = await maybeTranslateVirtualUnitRuns(
      layoutSource,
      nodes,
      walkId,
      config,
      toggle,
      forceRetranslation,
    )
    if (handled) return
  }

  return translateTranslationOnlyRun(nodes, walkId, config, toggle, forceRetranslation)
}

/** Labeled paragraphs directly under `container`, with no paragraph in between. */
function collectTopLevelParagraphDescendants(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[${PARAGRAPH_ATTRIBUTE}]`)].filter(
    (paragraph) => {
      const ancestor = paragraph.parentElement?.closest(`[${PARAGRAPH_ATTRIBUTE}]`)
      return !ancestor || ancestor === container || !container.contains(ancestor)
    },
  )
}

/**
 * A giant container whose plan cannot be materialized must NOT collapse into a
 * single request. The observer only hands such a container over whole because
 * the same predicate said its units were materializable; if the host reshaped
 * the DOM in between, translating it as one run would ship a whole 22k-char
 * note tweet in one payload and, on a failed alignment, displace every one of
 * its framework-owned nodes into a wrapper. Translating each labeled paragraph
 * separately reproduces what per-paragraph observation would have done.
 */
async function translateNonMaterializableGiant(
  layoutSource: HTMLElement,
  walkId: string,
  config: Config,
  forceRetranslation: boolean,
): Promise<boolean> {
  if (!isGiantParagraphUnit(layoutSource)) return false
  // Same content guard the observation gate applies: splitting into descendant
  // paragraphs drops the container's own direct text. Falling back to the
  // single run keeps that text rather than silently losing it here, after the
  // observer already refused to lose it.
  if (!canSplitGiantWithoutStrandingOwnText(layoutSource)) return false

  const paragraphs = collectTopLevelParagraphDescendants(layoutSource)
  if (paragraphs.length === 0) return false

  await Promise.allSettled(
    paragraphs.map((paragraph) =>
      translateTranslationOnlyRun([paragraph], walkId, config, false, forceRetranslation),
    ),
  )
  return true
}

/**
 * Translate a newline-preserving container one blank-line paragraph at a time,
 * matching the granularity bilingual mode gets from its virtual-paragraph plan.
 *
 * Each unit becomes a run of whole child nodes and goes through the ordinary
 * per-run pipeline, so every unit gets its own request, its own small-paragraph
 * and target-language filtering, its own spinner and error UI, and its own
 * restore record. Returns false when this container is not one to segment, so
 * the caller falls back to translating the request as a single run.
 */
async function maybeTranslateVirtualUnitRuns(
  layoutSource: HTMLElement,
  nodes: ChildNode[],
  walkId: string,
  config: Config,
  toggle: boolean,
  forceRetranslation: boolean,
): Promise<boolean> {
  const previousState = getTranslationOnlyAnchorState(layoutSource)
  const hasPreviousGeneration =
    previousState !== undefined &&
    (previousState.virtualGeneration !== undefined || (previousState.splitRecords?.length ?? 0) > 0)

  if (hasPreviousGeneration) {
    // Rebuild from scratch rather than patching a live generation: a plan built
    // over half-restored text would read our own translations as source and
    // send them back to the provider, and a second round of cuts over the first
    // round's tails could no longer be rejoined.
    teardownVirtualTranslationOnlyGeneration(layoutSource)
    if (toggle) return true
  } else if (
    previousState !== undefined ||
    layoutSource.querySelector(`.${CONTENT_WRAPPER_CLASS}`) !== null
  ) {
    // This container was translated as a single run. Its own path knows how to
    // restore or replace that, and segmenting on top of it would translate our
    // own output.
    return false
  }

  const plan = buildVirtualParagraphPlan(layoutSource, config)
  if (plan.units.length < 2) return false

  if (!canMaterializeVirtualParagraphUnits(layoutSource, plan, config)) {
    return translateNonMaterializableGiant(layoutSource, walkId, config, forceRetranslation)
  }

  if (!claimNodesForTranslation(nodes)) return true
  try {
    // Claim the anchor before cutting anything: from here on the marker is what
    // lets a page-wide cleanup find these cuts, even if every unit then fails.
    const state = ensureTranslationOnlyAnchorState(
      layoutSource,
      config,
      getTranslationOnlyAnchorState,
    )
    state.splitRecords ??= []
    virtualTranslationOnlyGenerationSequence += 1
    const generation = virtualTranslationOnlyGenerationSequence
    state.virtualGeneration = generation
    const isCurrent = () =>
      getTranslationOnlyAnchorState(layoutSource)?.virtualGeneration === generation

    const runs = materializeVirtualParagraphUnitRuns(layoutSource, plan, config, state.splitRecords)
    if (!runs) {
      // The host reshaped the container between planning and cutting. Undo
      // whatever was cut and let the single-run path have the request.
      teardownVirtualTranslationOnlyGeneration(layoutSource)
      return false
    }

    await Promise.allSettled(
      runs.map((run) =>
        translateTranslationOnlyRun(
          run.nodes,
          walkId,
          config,
          false,
          forceRetranslation,
          isCurrent,
        ),
      ),
    )

    // Queued, not called: each unit applies its swap through the same batch, so
    // running now would read an empty anchor and undo the generation just
    // before its own translations land.
    batchDOMOperation(() => {
      if (isCurrent()) endVirtualTranslationOnlyGeneration(layoutSource)
    })
    return true
  } finally {
    releaseNodesFromTranslation(nodes)
  }
}

/**
 * Close a finished generation. Units that landed keep their own swap records
 * (on the container or, for a single-element unit, on that element), so the
 * anchor stays. When nothing landed at all — every unit filtered out, or every
 * translation equal to its source — the container is handed back exactly as it
 * was found, cuts rejoined and marker removed.
 */
function endVirtualTranslationOnlyGeneration(layoutSource: HTMLElement): void {
  const state = getTranslationOnlyAnchorState(layoutSource)
  if (!state) return

  const leftNoTrace =
    state.swaps.length === 0 &&
    layoutSource.querySelector(`[${TRANSLATION_ONLY_ATTRIBUTE}]`) === null &&
    // An error UI still on screen belongs to a unit that has not resolved for
    // the user yet; rejoining its cuts would pull the message out from under it.
    layoutSource.querySelector(`.${CONTENT_WRAPPER_CLASS}`) === null
  if (leftNoTrace) {
    // Nothing landed. A full restore clears the generation, rejoins whatever
    // was cut and hands the marker back, leaving the container as found.
    restoreTranslationOnlySwapsForAnchor(layoutSource)
    return
  }

  // Something landed, so the generation stays recorded. It is the only durable
  // sign that this container is segmented: a unit that is a whole element
  // registers its record on that element, and such a generation may not have
  // cut anything at all, so neither the container's own swaps nor its split
  // records can tell a later toggle what this is. Cleared by the full restore
  // that ends the generation.
}

/**
 * Translate one run of sibling nodes: protect attributes, send the run's HTML
 * as a single request, then swap the translation into the site's own text
 * nodes (falling back to a wrapper when the response cannot be aligned).
 *
 * `isCurrent` lets a caller that owns several runs invalidate the ones still
 * in flight — the virtual-paragraph path uses it so a unit whose generation
 * was torn down mid-request cannot write its response into restored text.
 */
async function translateTranslationOnlyRun(
  nodes: ChildNode[],
  walkId: string,
  config: Config,
  toggle: boolean = false,
  forceRetranslation: boolean = false,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const isTransNodeAndNotTranslatedWrapper = (node: Node): node is TransNode => {
    if (isHTMLElement(node) && node.classList.contains(CONTENT_WRAPPER_CLASS)) return false
    return isTransNode(node)
  }

  const outerTransNodes = nodes.filter(isTransNode)
  if (outerTransNodes.length === 0) {
    return
  }

  let transNodes: TransNode[] = []
  let allChildNodes: ChildNode[] = []
  if (outerTransNodes.length === 1 && isHTMLElement(outerTransNodes[0]!)) {
    const unwrappedHTMLChild = unwrapDeepestOnlyHTMLChild(outerTransNodes[0], config)
    allChildNodes = [...unwrappedHTMLChild.childNodes]
    transNodes = allChildNodes.filter(isTransNodeAndNotTranslatedWrapper)
  } else {
    transNodes = outerTransNodes
    allChildNodes = nodes
  }

  if (transNodes.length === 0) {
    // The run may be nothing but a fallback wrapper whose originals were
    // displaced (e.g. a <li> holding only the translation). Its toggle must
    // still restore, so handle the wrapper before giving up on the run.
    const runWrappers = allChildNodes.filter(
      (node): node is HTMLElement =>
        isHTMLElement(node) &&
        node.classList.contains(CONTENT_WRAPPER_CLASS) &&
        node.getAttribute(TRANSLATION_MODE_ATTRIBUTE) ===
          ("translationOnly" satisfies TranslationMode) &&
        node.getAttribute(WALKED_ATTRIBUTE) !== walkId,
    )
    if (runWrappers.length === 0) return
    const restored: ChildNode[] = []
    for (const wrapper of runWrappers) {
      restored.push(...removeTranslatedWrapperWithRestore(wrapper))
    }
    if (!toggle) {
      const retryNodes = restored.filter((node) => node.isConnected)
      if (retryNodes.length > 0) {
        void translateTranslationOnlyRun(retryNodes, walkId, config, toggle, forceRetranslation)
      }
    }
    return
  }

  try {
    if (!claimNodesForTranslation(nodes)) {
      return
    }

    const targetNode = transNodes.at(-1)!

    const parentNode = targetNode.parentElement
    if (!parentNode) {
      console.error("targetNode.parentElement is not HTMLElement", targetNode.parentElement)
      return
    }
    // An in-place swap leaves no wrapper — the anchor marker is the handle.
    // Restore FIRST (before any wrapper handling): a swapped run must undo its
    // own swap, never let an unrelated nested run's wrapper stand in for it.
    // Also runs before the filter/language checks below so they (and a
    // retranslation) see original text, not the previous translation.
    // Non-toggle (retranslation) keeps the records registered so the anchor
    // stays monitored through the provider round-trip — a re-swap dropped by
    // the mid-flight snapshot guard must not leave the region unwatched.
    const swapAnchor = parentNode.closest<HTMLElement>(`[${TRANSLATION_ONLY_ATTRIBUTE}]`)
    const restoredOwnSwap = swapAnchor
      ? restoreTranslationOnlySwapsForAnchor(
          swapAnchor,
          transNodes,
          toggle ? undefined : { keepRecords: true },
        )
      : false

    // Own-run wrapper discovery is scoped to the run itself: the fallback
    // wrapper is always inserted as a sibling within the run or appended into
    // a single-element run — a deep subtree query would steal a NESTED run's
    // wrapper (e.g. a li's) and leave this run's state untouched (#1846 review).
    // Reuse the parent captured above: the restore-first pass may have taken
    // targetNode out of the document, and re-reading its parentElement would
    // throw on the null.
    const existedTranslatedWrapperOutside = parentNode.closest(`.${CONTENT_WRAPPER_CLASS}`)
    const finalTranslatedWrapper =
      existedTranslatedWrapperOutside ?? findRunTranslationOnlyWrapper(allChildNodes, walkId)
    if (finalTranslatedWrapper && isHTMLElement(finalTranslatedWrapper)) {
      const restoredNodes = removeTranslatedWrapperWithRestore(finalTranslatedWrapper)
      if (toggle) {
        return
      }
      // The restore synchronously re-inserted the SAME original node objects,
      // so when `nodes` are still connected they remain the correct
      // retranslation input. When they referenced the removed wrapper or its
      // translated content (both detached now), retranslate the restored
      // originals instead. Neither side connected means the host rebuilt the
      // region — leave it alone rather than loop.
      releaseNodesFromTranslation(nodes)
      const retryNodes = nodes.some((node) => node.isConnected)
        ? nodes
        : restoredNodes.filter((node) => node.isConnected)
      if (retryNodes.length > 0) {
        void translateTranslationOnlyRun(retryNodes, walkId, config, toggle, forceRetranslation)
      }
      return
    }

    if (restoredOwnSwap && toggle) {
      return
    }

    const innerTextContent = transNodes.map((node) => extractTextContent(node, config)).join("")
    if (!innerTextContent.trim() || isNumericContent(innerTextContent)) return

    if (await shouldFilterSmallParagraph(innerTextContent, config)) return

    // Check the plain text, not the HTML string sent to the provider — franc
    // on markup is noise. Runs before the wrapper is inserted into the DOM.
    if (await shouldSkipAsTargetLanguage(innerTextContent, config)) return

    const ownerDoc = getOwnerDocument(targetNode)
    const protectedHtml = protectTranslationHtmlAttributes(transNodes, ownerDoc)
    const textContent = protectedHtml.sourceHtml
    if (!textContent) return

    // Taken before the provider request; the response handler compares against
    // it to detect host mutations that happened while the request was in
    // flight (never swap over content the host has since rewritten).
    const sourceSnapshot = snapshotSourceTextNodes(transNodes)

    const translatedWrapperNode = ownerDoc.createElement("span")
    translatedWrapperNode.className = `${NOTRANSLATE_CLASS} ${CONTENT_WRAPPER_CLASS}`
    translatedWrapperNode.setAttribute(
      TRANSLATION_MODE_ATTRIBUTE,
      "translationOnly" satisfies TranslationMode,
    )
    translatedWrapperNode.setAttribute(WALKED_ATTRIBUTE, walkId)
    translatedWrapperNode.style.display = "contents"
    setTranslationDirAndLang(translatedWrapperNode, config)
    const spinner = createSpinnerInside(translatedWrapperNode)

    // Batch DOM insertion to reduce layout thrashing
    const insertOperation = () => {
      if (isTextNode(targetNode) || transNodes.length > 1) {
        targetNode.parentNode?.insertBefore(translatedWrapperNode, targetNode.nextSibling)
      } else {
        targetNode.appendChild(translatedWrapperNode)
      }
    }
    batchDOMOperation(insertOperation)

    // The source string mixes text nodes with element outerHTML and the result
    // is re-rendered via innerHTML, so providers must treat it as HTML to keep
    // its tags intact.
    const deepLXProviderKey = getDeepLXHtmlAttributeProviderKey(config)
    const translateLegacyHtml = async () => {
      const translatedHtml = await translateTextForAction(
        protectedHtml.legacyRequestHtml,
        "html",
        forceRetranslation,
      )
      return translatedHtml ? protectedHtml.restoreLegacy(translatedHtml) : translatedHtml
    }
    const translateRequest = async () => {
      if (!protectedHtml.hasPlaceholders) return translateLegacyHtml()

      let ownedDeepLXProbe: DeepLXHtmlAttributeProbe | undefined
      if (deepLXProviderKey) {
        const probeDecision = await acquireDeepLXHtmlAttributeProbe(deepLXProviderKey)
        if (probeDecision.useLegacy) return translateLegacyHtml()
        ownedDeepLXProbe = probeDecision.probe
      }

      try {
        const translatedHtml = await translateTextForAction(
          protectedHtml.requestHtml,
          "html",
          forceRetranslation,
        )
        if (!translatedHtml) {
          if (deepLXProviderKey) {
            finishDeepLXHtmlAttributeProbe(deepLXProviderKey, ownedDeepLXProbe, "unknown")
          }
          return translatedHtml
        }

        const restoredHtml = protectedHtml.restore(translatedHtml)
        if (deepLXProviderKey) {
          supportedDeepLXHtmlAttributeProviders.add(deepLXProviderKey)
          finishDeepLXHtmlAttributeProbe(deepLXProviderKey, ownedDeepLXProbe, "supported")
        }
        return restoredHtml
      } catch (error) {
        if (!isHtmlAttributeMarkerIntegrityError(error)) {
          if (deepLXProviderKey) {
            finishDeepLXHtmlAttributeProbe(deepLXProviderKey, ownedDeepLXProbe, "unknown")
          }
          throw error
        }

        if (deepLXProviderKey) {
          unsupportedDeepLXHtmlAttributeProviders.add(deepLXProviderKey)
          supportedDeepLXHtmlAttributeProviders.delete(deepLXProviderKey)
          finishDeepLXHtmlAttributeProbe(deepLXProviderKey, ownedDeepLXProbe, "unsupported")
        }
        logger.warn("HTML attribute placeholders were not preserved; retrying full HTML", error)
        return translateLegacyHtml()
      }
    }

    const realTranslatedText = await getTranslatedTextAndRemoveSpinner(
      nodes,
      textContent,
      spinner,
      translatedWrapperNode,
      isCurrent,
      "html",
      translateRequest,
    )
    const translatedText = realTranslatedText
      ? getDisplayTranslation(
          protectedHtml.comparisonSourceHtml,
          realTranslatedText,
          protectedHtml.normalizeForComparison(realTranslatedText),
        )
      : realTranslatedText

    if (!translatedText) {
      // Keep the wrapper when translation failed so the injected error UI remains visible.
      // Only remove the wrapper when translation returned an empty string.
      if (translatedText === "") {
        markExtensionDrivenNodeRemoval(translatedWrapperNode)
        // Batch the remove operation to execute remove operation after insert operation
        batchDOMOperation(() => translatedWrapperNode.remove())
      }
      return
    }

    // Preferred strategy: swap the translation into the site's OWN text nodes,
    // leaving element identity (framework fibers, listeners) untouched. The
    // wrapper was only the spinner vehicle and is removed.
    const swapPlan = planInPlaceTextSwap(transNodes, translatedText, ownerDoc)
    if (swapPlan) {
      batchDOMOperation(() => {
        // Wrapper gone: a global cleanup ran while the provider call was in
        // flight, or the host re-rendered the region — leave originals alone.
        // A superseded run (its generation torn down) is stale for the same
        // reason even when its wrapper survived the round trip.
        if (!translatedWrapperNode.isConnected || !isCurrent()) return
        markExtensionDrivenNodeRemoval(translatedWrapperNode)
        translatedWrapperNode.remove()
        // Host mutated the run mid-flight: the translation is stale, drop it.
        // Any kept (restore-first) records still reference the run, so the
        // staleness pipeline retries with the host's fresh text.
        if (!verifySourceSnapshot(transNodes, sourceSnapshot)) return
        applyInPlaceTextSwap(
          swapPlan,
          transNodes,
          parentNode,
          walkId,
          config,
          getTranslationOnlyAnchorState,
        )
      })
      return
    }

    // Fallback strategy: render into the wrapper and displace the originals,
    // retaining the node objects so restore can re-insert the same nodes (#1846).
    translatedWrapperNode.innerHTML = translatedText

    // Batch final DOM mutations to reduce layout thrashing
    batchDOMOperation(() => {
      // Wrapper gone from the document: a global cleanup ran while the provider
      // call was in flight, or the host re-rendered the region. The originals
      // are the live content — don't remove them to apply a stale translation.
      if (!translatedWrapperNode.isConnected || !isCurrent()) return

      // Insert translated content after the last node
      const lastChildNode = allChildNodes.at(-1)!
      lastChildNode.parentNode?.insertBefore(translatedWrapperNode, lastChildNode.nextSibling)

      registerTranslationOnlyOriginals(translatedWrapperNode, allChildNodes)
      allChildNodes.forEach((childNode) => childNode.remove())
      // The wrapper now owns this run; kept swap records (restore-first
      // retranslation) would reference displaced nodes and read as
      // permanently stale — drop them.
      if (swapAnchor) dropTranslationOnlySwapRecordsForNodes(swapAnchor, transNodes)
    })
  } finally {
    releaseNodesFromTranslation(nodes)
  }
}
