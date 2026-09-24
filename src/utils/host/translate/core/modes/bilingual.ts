import type { Config } from "@/types/config/config"
import type { TranslationMode } from "@/types/config/translate"
import {
  CONTENT_WRAPPER_CLASS,
  NOTRANSLATE_CLASS,
  TRANSLATION_ERROR_CONTAINER_CLASS,
  TRANSLATION_MODE_ATTRIBUTE,
  TRANSLATION_ONLY_ATTRIBUTE,
  VIRTUAL_PARAGRAPH_ATTRIBUTE,
  WALKED_ATTRIBUTE,
} from "../../../../constants/dom-labels"
import {
  isBlockTransNode,
  isHTMLElement,
  isNaturalBlockTransNode,
  isSiteRuleForceBlockStyleElement,
  isTextNode,
  isTransNode,
} from "../../../dom/filter"
import { unwrapDeepestOnlyHTMLChild } from "../../../dom/find"
import { getOwnerDocument } from "../../../dom/node"
import { extractTextContent } from "../../../dom/traversal"
import {
  buildVirtualParagraphPlan,
  isNewlinePreservingElement,
  moveParagraphInsertionBoundaryAfterTrailingInlineImages,
  type VirtualParagraphUnit,
} from "../../dom/paragraph-segmentation"
import {
  disposeVirtualParagraphGroup,
  dropVirtualParagraphWrapper,
  removeOrphanVirtualParagraphWrappers,
  removeTranslatedWrapperWithRestore,
  restoreTranslationOnlySwapsForAnchor,
} from "../../dom/translation-cleanup"
import { insertTranslatedNodeIntoWrapper } from "../../dom/translation-insertion"
import { findPreviousTranslatedWrapperInside } from "../../dom/translation-wrapper"
import { insertVirtualParagraphWrappers } from "../../dom/virtual-paragraph-insertion"
import { shouldFilterSmallParagraph } from "../../filter-small-paragraph"
import { shouldSkipAsTargetLanguage } from "../../target-language-skip"
import { translateTextForPage } from "../../translate-variants"
import { setTranslationDirAndLang } from "../../translation-attributes"
import {
  createSpinnerInside,
  getTranslatedTextAndRemoveSpinner,
} from "../../ui/spinner"
import { isNumericContent } from "../../ui/translation-utils"
import type {
  BilingualTranslationState,
  VirtualParagraphGroup,
  VirtualParagraphSourceSnapshot,
} from "../translation-state"
import {
  attachBilingualTranslationWrapper,
  collectSourceTextExcludingWrappers,
  countWrapperTamperRepair,
  getBilingualTranslationStateForSource,
  getVirtualParagraphGroupForSource,
  isBilingualTranslationStateCurrent,
  isBilingualWrapperContentTampered,
  isVirtualParagraphGroupCurrent,
  MAX_WRAPPER_TAMPER_REPAIRS,
  markVirtualParagraphGroupInserted,
  registerBilingualTranslationState,
  registerVirtualParagraphGroup,
  registerVirtualParagraphWrapper,
  resetWrapperTamperRepairs,
  unregisterBilingualTranslationState,
} from "../translation-state"
import {
  claimNodesForTranslation,
  getDisplayTranslation,
  releaseNodesFromTranslation,
} from "./shared"

let virtualParagraphGroupSequence = 0

function createBilingualWrapper(
  ownerDoc: Document,
  walkId: string,
  config: Config,
  virtualParagraphId?: string,
): { spinner: HTMLElement; wrapper: HTMLElement } {
  const wrapper = ownerDoc.createElement("span")
  wrapper.className = `${NOTRANSLATE_CLASS} ${CONTENT_WRAPPER_CLASS}`
  wrapper.setAttribute(TRANSLATION_MODE_ATTRIBUTE, "bilingual" satisfies TranslationMode)
  wrapper.setAttribute(WALKED_ATTRIBUTE, walkId)
  if (virtualParagraphId) {
    wrapper.setAttribute(VIRTUAL_PARAGRAPH_ATTRIBUTE, virtualParagraphId)
  }
  setTranslationDirAndLang(wrapper, config)
  return { spinner: createSpinnerInside(wrapper), wrapper }
}

async function filterVirtualParagraphUnits(
  units: VirtualParagraphUnit[],
  config: Config,
): Promise<VirtualParagraphUnit[]> {
  const included = await Promise.all(
    units.map(async (unit) => {
      if (isNumericContent(unit.text)) return false
      if (await shouldFilterSmallParagraph(unit.text, config)) return false
      return !(await shouldSkipAsTargetLanguage(unit.text, config))
    }),
  )
  return units.filter((_, index) => included[index])
}

async function translateVirtualParagraph(
  entry: ReturnType<typeof insertVirtualParagraphWrappers>["inserted"][number],
  spinner: HTMLElement,
  group: VirtualParagraphGroup,
  nodes: ChildNode[],
  config: Config,
  forceBlockTranslation: boolean,
  forceRetranslation: boolean = false,
): Promise<void> {
  const { unit, wrapper } = entry
  const isCurrent = () => isVirtualParagraphGroupCurrent(group, wrapper)
  if (!isCurrent()) return

  const realTranslatedText = await getTranslatedTextAndRemoveSpinner(
    nodes,
    unit.text,
    spinner,
    wrapper,
    isCurrent,
    "plain",
    // Virtual units exist only inside newline-preserving containers, so their
    // interior single newlines (bullet lists) are always semantic.
    () =>
      translateTextForPage(unit.text, "plain", {
        preserveLineBreaks: true,
        forceRetranslation,
      }),
  )
  if (!isCurrent()) {
    disposeVirtualParagraphGroup(group)
    return
  }

  const translatedText = getDisplayTranslation(unit.text, realTranslatedText)
  if (translatedText === "") {
    dropVirtualParagraphWrapper(group, wrapper)
    return
  }
  if (translatedText === undefined) {
    if (!wrapper.querySelector(`.${TRANSLATION_ERROR_CONTAINER_CLASS}`)) {
      dropVirtualParagraphWrapper(group, wrapper)
    }
    return
  }

  await insertTranslatedNodeIntoWrapper(
    wrapper,
    { isCurrent, layoutSource: group.layoutSource, sourceText: unit.text },
    translatedText,
    config.pageTranslation.translationNodeStyle,
    config,
    forceBlockTranslation,
  )
  if (!isCurrent()) disposeVirtualParagraphGroup(group)
}

async function translateVirtualParagraphs(
  nodes: ChildNode[],
  units: VirtualParagraphUnit[],
  sourceSnapshots: VirtualParagraphSourceSnapshot[],
  layoutSource: HTMLElement,
  walkId: string,
  config: Config,
  forceBlockTranslation: boolean,
  forceRetranslation: boolean = false,
): Promise<void> {
  // One synchronous read feeds both the group's staleness baseline and the
  // post-filter comparison below; the deliberate re-read inside the stale
  // check detects host mutations that land during the filter await.
  const sourceTextSnapshot = collectSourceTextExcludingWrappers(layoutSource)
  const group: VirtualParagraphGroup = {
    id: `${walkId}:${virtualParagraphGroupSequence++}`,
    walkId,
    status: "active",
    layoutSource,
    wrappers: new Set(),
    splitRecords: [],
    sourceSnapshots,
    sourceTextContent: sourceTextSnapshot,
    wrapperPlacements: new Map(),
  }
  registerVirtualParagraphGroup(group)

  let includedUnits: VirtualParagraphUnit[]
  try {
    includedUnits = await filterVirtualParagraphUnits(units, config)
  } catch (error) {
    disposeVirtualParagraphGroup(group)
    throw error
  }

  if (
    !isVirtualParagraphGroupCurrent(group) ||
    collectSourceTextExcludingWrappers(layoutSource) !== sourceTextSnapshot
  ) {
    disposeVirtualParagraphGroup(group)
    return
  }
  if (includedUnits.length === 0) {
    disposeVirtualParagraphGroup(group)
    return
  }

  const ownerDoc = getOwnerDocument(layoutSource)
  const spinners = new Map<HTMLElement, HTMLElement>()
  const entries = includedUnits.map((unit) => {
    const { spinner, wrapper } = createBilingualWrapper(
      ownerDoc,
      walkId,
      config,
      `${group.id}:${unit.id}`,
    )
    spinners.set(wrapper, spinner)
    registerVirtualParagraphWrapper(group, wrapper)
    return { unit, wrapper }
  })

  let inserted: ReturnType<typeof insertVirtualParagraphWrappers>["inserted"]
  try {
    ;({ inserted } = insertVirtualParagraphWrappers(entries, group.splitRecords))
  } catch (error) {
    disposeVirtualParagraphGroup(group)
    throw error
  }

  markVirtualParagraphGroupInserted(group)
  if (!isVirtualParagraphGroupCurrent(group)) {
    disposeVirtualParagraphGroup(group)
    return
  }

  await Promise.allSettled(
    inserted.map((entry) =>
      translateVirtualParagraph(
        entry,
        spinners.get(entry.wrapper)!,
        group,
        nodes,
        config,
        forceBlockTranslation,
        forceRetranslation,
      ),
    ),
  )
}

export async function translateNodesBilingualMode(
  nodes: ChildNode[],
  walkId: string,
  config: Config,
  toggle: boolean = false,
  forceBlockTranslation: boolean = false,
  forceRetranslation: boolean = false,
): Promise<void> {
  const transNodes = nodes.filter((node) => isTransNode(node))
  if (transNodes.length === 0) {
    return
  }

  const layoutSource = transNodes.at(-1)!
  const virtualLayoutSource =
    transNodes.length === 1 && isHTMLElement(layoutSource) && isBlockTransNode(layoutSource)
      ? layoutSource
      : undefined

  if (virtualLayoutSource) {
    const existingGroup = getVirtualParagraphGroupForSource(virtualLayoutSource)
    if (existingGroup) {
      const isSameActiveWalk =
        existingGroup.walkId === walkId && isVirtualParagraphGroupCurrent(existingGroup)
      if (!toggle && isSameActiveWalk) return

      disposeVirtualParagraphGroup(existingGroup)
      if (toggle) return

      // A previous generation may still be awaiting its provider. Its group
      // ownership guard prevents stale writes, so the fresh walk can proceed.
      releaseNodesFromTranslation(transNodes)
    } else if (removeOrphanVirtualParagraphWrappers(virtualLayoutSource) && toggle) {
      return
    }
  }

  if (isHTMLElement(layoutSource)) {
    const existingBilingualState = getBilingualTranslationStateForSource(layoutSource)
    if (existingBilingualState) {
      const isSameActiveWalk =
        existingBilingualState.walkId === walkId &&
        isBilingualTranslationStateCurrent(existingBilingualState)
      if (!toggle && isSameActiveWalk) return

      if (!toggle && isBilingualWrapperContentTampered(existingBilingualState)) {
        // The site rewrote our wrapper content while the host text is intact
        // (#1918). Repair by retranslating — but a script that rewrites
        // deterministically would fight forever (the retranslation budget
        // bounds rate, not duration), so after MAX_WRAPPER_TAMPER_REPAIRS
        // losses adopt the site's version as the expected content: the
        // pre-#1918 terminal state, reached after real repair attempts.
        if (countWrapperTamperRepair(layoutSource) > MAX_WRAPPER_TAMPER_REPAIRS) {
          existingBilingualState.wrapperTextContent =
            existingBilingualState.wrapper?.textContent ?? null
          return
        }
      } else {
        // Genuine host change, toggle, or new session: the fight (if any) is
        // over — re-arm the capitulation budget.
        resetWrapperTamperRepairs(layoutSource)
      }

      if (existingBilingualState.wrapper) {
        removeTranslatedWrapperWithRestore(existingBilingualState.wrapper)
      } else {
        unregisterBilingualTranslationState(existingBilingualState)
      }
      if (toggle) return
      releaseNodesFromTranslation(transNodes)
    }
  }

  try {
    // prevent duplicate translation
    if (!claimNodesForTranslation(transNodes)) {
      return
    }

    if (virtualLayoutSource) {
      const virtualParagraphPlan = buildVirtualParagraphPlan(virtualLayoutSource, config)
      if (virtualParagraphPlan.units.length >= 2) {
        // Explicit blank-line boundaries represent block paragraphs even when
        // an individual unit is short enough for the compact-label heuristic.
        await translateVirtualParagraphs(
          nodes,
          virtualParagraphPlan.units,
          virtualParagraphPlan.sourceSnapshots,
          virtualLayoutSource,
          walkId,
          config,
          forceBlockTranslation || isNaturalBlockTransNode(virtualLayoutSource),
          forceRetranslation,
        )
        return
      }
    }

    const shouldUnwrapSingleBlockSource =
      transNodes.length === 1 &&
      isHTMLElement(layoutSource) &&
      (isNaturalBlockTransNode(layoutSource) ||
        (isBlockTransNode(layoutSource) && isSiteRuleForceBlockStyleElement(layoutSource, config)))
    const insertionTarget = shouldUnwrapSingleBlockSource
      ? unwrapDeepestOnlyHTMLChild(layoutSource, config)
      : layoutSource

    const existedTranslatedWrapper = findPreviousTranslatedWrapperInside(insertionTarget, walkId)
    if (existedTranslatedWrapper) {
      removeTranslatedWrapperWithRestore(existedTranslatedWrapper)
      if (toggle) {
        return
      }
      releaseNodesFromTranslation(nodes)
      return translateNodesBilingualMode(
        nodes,
        walkId,
        config,
        toggle,
        forceBlockTranslation,
        forceRetranslation,
      )
    }

    // After a translationOnly session, an in-place-swapped paragraph has no
    // wrapper — only the anchor marker. A bilingual toggle over it must undo
    // the swap (and a bilingual translate must see the original text).
    const swappedAnchor = (
      isHTMLElement(insertionTarget) ? insertionTarget : insertionTarget.parentElement
    )?.closest<HTMLElement>(`[${TRANSLATION_ONLY_ATTRIBUTE}]`)
    if (
      swappedAnchor &&
      restoreTranslationOnlySwapsForAnchor(swappedAnchor, transNodes) &&
      toggle
    ) {
      return
    }

    const sourceTextBeforeFilter = isHTMLElement(layoutSource)
      ? collectSourceTextExcludingWrappers(layoutSource)
      : null
    const textContent = transNodes
      .map((node) => extractTextContent(node, config))
      .join("")
      .trim()
    if (!textContent || isNumericContent(textContent)) return

    let bilingualState: BilingualTranslationState | undefined
    if (isHTMLElement(layoutSource) && sourceTextBeforeFilter !== null) {
      bilingualState = {
        layoutSource,
        sourceTextContent: sourceTextBeforeFilter,
        status: "active",
        walkId,
        wrapper: null,
        wrapperTextContent: null,
      }
      registerBilingualTranslationState(bilingualState)
    }

    let shouldFilter: boolean
    try {
      // Target-language skip runs here, BEFORE the wrapper/spinner is inserted,
      // so same-language paragraphs never touch the DOM.
      shouldFilter =
        (await shouldFilterSmallParagraph(textContent, config)) ||
        (await shouldSkipAsTargetLanguage(textContent, config))
    } catch (error) {
      if (bilingualState) unregisterBilingualTranslationState(bilingualState)
      throw error
    }

    if (bilingualState && !isBilingualTranslationStateCurrent(bilingualState)) {
      const shouldRetry =
        getBilingualTranslationStateForSource(layoutSource as HTMLElement) === bilingualState &&
        layoutSource.isConnected
      unregisterBilingualTranslationState(bilingualState)
      if (shouldRetry) {
        releaseNodesFromTranslation(nodes)
        return translateNodesBilingualMode(
          nodes,
          walkId,
          config,
          toggle,
          forceBlockTranslation,
          forceRetranslation,
        )
      }
      return
    }
    if (shouldFilter) {
      if (bilingualState) unregisterBilingualTranslationState(bilingualState)
      return
    }

    const ownerDoc = getOwnerDocument(insertionTarget)
    const { spinner, wrapper: translatedWrapperNode } = createBilingualWrapper(
      ownerDoc,
      walkId,
      config,
    )
    let hasTrailingInlineImageAttachment = false

    if (transNodes.length === 1 && isHTMLElement(layoutSource) && isHTMLElement(insertionTarget)) {
      const originalInsertionBoundary = {
        container: insertionTarget,
        offset: insertionTarget.childNodes.length,
      }
      const insertionBoundary = moveParagraphInsertionBoundaryAfterTrailingInlineImages(
        originalInsertionBoundary,
        layoutSource,
      )
      hasTrailingInlineImageAttachment =
        insertionBoundary.container !== originalInsertionBoundary.container ||
        insertionBoundary.offset !== originalInsertionBoundary.offset
      insertionBoundary.container.insertBefore(
        translatedWrapperNode,
        insertionBoundary.container.childNodes[insertionBoundary.offset] ?? null,
      )
    } else if (isTextNode(insertionTarget) || transNodes.length > 1) {
      insertionTarget.parentNode?.insertBefore(translatedWrapperNode, insertionTarget.nextSibling)
    } else {
      insertionTarget.appendChild(translatedWrapperNode)
    }

    if (isHTMLElement(layoutSource) && layoutSource.contains(translatedWrapperNode)) {
      if (bilingualState) {
        attachBilingualTranslationWrapper(bilingualState, translatedWrapperNode)
      }
    } else if (bilingualState) {
      unregisterBilingualTranslationState(bilingualState)
      bilingualState = undefined
    }
    const isCurrent = () =>
      bilingualState
        ? isBilingualTranslationStateCurrent(bilingualState)
        : translatedWrapperNode.isConnected

    // Newline-preserving containers render single "\n" as real line breaks
    // (an X tweet whose lines have no blank-line separators is ONE unit here,
    // e.g. https://x.com/EpsteinJeffrey0/status/2083709421386080579 — five
    // lines split by single "\n" that Google merged into one run-on line),
    // so the provider must not collapse them. The FLOW CONTAINER's white-space
    // governs how the run's newlines render: for an inline layout source
    // (e.g. a GitHub inline <code> with its own break-spaces inside a normal
    // paragraph) the parent's value is authoritative, not the element's own.
    const flowContainer =
      isHTMLElement(layoutSource) && isBlockTransNode(layoutSource)
        ? layoutSource
        : layoutSource.parentElement
    const preserveLineBreaks = flowContainer ? isNewlinePreservingElement(flowContainer) : false

    const realTranslatedText = await getTranslatedTextAndRemoveSpinner(
      nodes,
      textContent,
      spinner,
      translatedWrapperNode,
      isCurrent,
      "plain",
      () =>
        translateTextForPage(textContent, "plain", {
          preserveLineBreaks,
          forceRetranslation,
        }),
    )

    if (!isCurrent()) {
      removeTranslatedWrapperWithRestore(translatedWrapperNode)
      return
    }

    const translatedText = getDisplayTranslation(textContent, realTranslatedText)

    if (translatedText === "") {
      removeTranslatedWrapperWithRestore(translatedWrapperNode)
      return
    }
    if (translatedText === undefined) {
      if (!translatedWrapperNode.querySelector(`.${TRANSLATION_ERROR_CONTAINER_CLASS}`)) {
        removeTranslatedWrapperWithRestore(translatedWrapperNode)
      }
      return
    }

    await insertTranslatedNodeIntoWrapper(
      translatedWrapperNode,
      {
        isCurrent,
        layoutSource,
        styleSources: transNodes,
        // Wrapper-content integrity snapshot (#1918): armed synchronously at
        // append time so a site rewrite landing during the decorate await can
        // never be canonized as the expected content.
        onContentInserted: (wrapper) => {
          if (bilingualState) bilingualState.wrapperTextContent = wrapper.textContent
        },
        sourceText: textContent,
      },
      translatedText,
      config.pageTranslation.translationNodeStyle,
      config,
      forceBlockTranslation || hasTrailingInlineImageAttachment,
    )
    if (!isCurrent()) removeTranslatedWrapperWithRestore(translatedWrapperNode)
  } finally {
    releaseNodesFromTranslation(transNodes)
  }
}
