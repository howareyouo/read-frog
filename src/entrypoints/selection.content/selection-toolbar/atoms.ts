import { dequal } from "dequal"
import { atom } from "jotai"
import { selectAtom } from "jotai/utils"
import { atomFamily } from "jotai-family"
import type { Config } from "@/types/config/config"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { configAtom } from "@/utils/atoms/config"
import { getFeatureProviders } from "@/utils/constants/feature-providers"
import { findSelectionToolbarAction } from "@/utils/custom-actions"
import type {
  CustomActionProviderRef,
  SelectionTranslationProviderRef,
} from "@/utils/providers/provider-registry"
import { resolveProviderRefForCapability } from "@/utils/providers/provider-registry"
import type { ContextSnapshot, SelectionSnapshot } from "../utils"
import { buildContextSnapshot } from "../utils"

export interface SelectionSession {
  id: number
  createdAt: number
  selectionSnapshot: SelectionSnapshot
  contextSnapshot: ContextSnapshot
}

let nextSelectionSessionId = 0

function createSelectionSession(
  selection: SelectionSnapshot | null,
  context: ContextSnapshot | null,
): SelectionSession | null {
  if (!selection) {
    return null
  }

  const nextContext = context ?? buildContextSnapshot(selection)
  if (!nextContext) {
    return null
  }

  return {
    id: ++nextSelectionSessionId,
    createdAt: Date.now(),
    selectionSnapshot: selection,
    contextSnapshot: nextContext,
  }
}

export const selectionSessionAtom = atom<SelectionSession | null>(null)
export const selectionAtom = atom(
  (get) => get(selectionSessionAtom)?.selectionSnapshot ?? null,
  (_get, set, nextSelection: SelectionSnapshot | null) => {
    if (!nextSelection) {
      set(selectionSessionAtom, null)
      return
    }

    set(
      selectionSessionAtom,
      createSelectionSession(nextSelection, buildContextSnapshot(nextSelection)),
    )
  },
)
export const contextAtom = atom(
  (get) => get(selectionSessionAtom)?.contextSnapshot ?? null,
  (get, set, nextContext: ContextSnapshot | null) => {
    const currentSelection = get(selectionAtom)
    set(selectionSessionAtom, createSelectionSession(currentSelection, nextContext))
  },
)
export const isSelectionToolbarVisibleAtom = atom<boolean>(false)

export const selectionContentAtom = atom((get) => get(selectionAtom)?.text ?? null)

export const setSelectionStateAtom = atom(
  null,
  (
    _get,
    set,
    nextState: { selection: SelectionSnapshot | null; context: ContextSnapshot | null },
  ) => {
    set(selectionSessionAtom, createSelectionSession(nextState.selection, nextState.context))
  },
)

export const clearSelectionStateAtom = atom(null, (_get, set) => {
  set(selectionSessionAtom, null)
})

export interface SelectionToolbarTranslateRequestSlice {
  language: Config["language"]
  enableAIContentAware: boolean
  customPromptsConfig: Config["pageTranslation"]["customPromptsConfig"]
  provider: SelectionTranslationProviderRef | null
  /** Every selected provider the feature rotates through; runTranslation picks round-robin. */
  providers: SelectionTranslationProviderRef[]
}

export interface SelectionToolbarCustomActionRequestSlice {
  language: Config["language"]
  action: SelectionToolbarCustomAction | null
  provider: CustomActionProviderRef | null
}

function createSelectionToolbarTranslateRequestSliceAtom() {
  return selectAtom(
    configAtom,
    (config): SelectionToolbarTranslateRequestSlice => {
      const providers = getFeatureProviders(config, "selectionTranslation")
      const providerRefs = providers
        .map(
          (id) =>
            resolveProviderRefForCapability(
              "selectionTranslation",
              config.providersConfig,
              id,
            ) as SelectionTranslationProviderRef | null,
        )
        .filter((ref): ref is SelectionTranslationProviderRef => ref !== null)

      return {
        language: config.language,
        enableAIContentAware: config.pageTranslation.enableAIContentAware,
        customPromptsConfig: config.pageTranslation.customPromptsConfig,
        provider: providerRefs[0] ?? null,
        providers: providerRefs,
      }
    },
    dequal,
  )
}

function createSelectionToolbarCustomActionRequestSliceAtom(actionId: string) {
  return selectAtom(
    configAtom,
    (config): SelectionToolbarCustomActionRequestSlice => {
      const candidate = findSelectionToolbarAction(config.selectionToolbar, actionId)
      const action = candidate && candidate.enabled !== false ? candidate : null

      return {
        language: config.language,
        action,
        provider: action
          ? resolveProviderRefForCapability("customAction", config.providersConfig, action.provider)
          : null,
      }
    },
    dequal,
  )
}

export const selectionToolbarTranslateRequestAtom =
  createSelectionToolbarTranslateRequestSliceAtom()

export const selectionToolbarCustomActionRequestAtomFamily = atomFamily((actionId: string) =>
  createSelectionToolbarCustomActionRequestSliceAtom(actionId),
)
