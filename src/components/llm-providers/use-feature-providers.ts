import { useAtomValue, useSetAtom } from "jotai"
import { useCallback, useMemo } from "react"
import type { ProviderConfig } from "@/types/config/provider"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { configAtom, configFieldsAtomMap, writeConfigAtom } from "@/utils/atoms/config"
import { getProviderConfigById } from "@/utils/config/helpers"
import type { FeatureKey } from "@/utils/constants/feature-providers"
import {
  buildFeatureProvidersPatch,
  FEATURE_PROVIDER_DEFS,
} from "@/utils/constants/feature-providers"
import { getSelectionToolbarActions, patchSelectionToolbarAction } from "@/utils/custom-actions"
import type { ProviderSelectorOption } from "@/utils/providers/provider-display"
import {
  getSelectableProvidersForCapability,
  type ProviderCapability,
} from "@/utils/providers/provider-registry"
import { providerSupportsTranslationOnlyMode } from "@/utils/providers/translation-only-gate"

/**
 * The enabled providers a capability can run on, as selector options — the
 * read-only list every provider picker starts from.
 */
export function useSelectableProviders(capability: ProviderCapability) {
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)
  return useMemo(
    () => getSelectableProvidersForCapability(capability, providersConfig),
    [capability, providersConfig],
  )
}

export interface FeatureProviderBinding {
  providerOptions: ProviderSelectorOption[]
  /** The primary provider — first of `providers`. */
  provider: string
  providers: string[]
  providerConfig: ProviderConfig | null
  setProvider: (provider: string) => void
  setProviders: (providers: string[]) => void
}

/** Reads and writes the provider a built-in feature runs on, independent of how it is laid out. */
export function useFeatureProvider(featureKey: FeatureKey): FeatureProviderBinding {
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(writeConfigAtom)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)
  const translationMode = useAtomValue(configFieldsAtomMap.pageTranslation).mode
  const providers = FEATURE_PROVIDER_DEFS[featureKey].getProviders(config)
  const provider = providers[0] ?? ""

  // Page translate in translationOnly mode cannot run on providers without
  // markup support (see translation-only-gate.ts) — hide them so the blocked
  // combination cannot be formed from a provider picker. Other features keep
  // the full list.
  const hideTranslationOnlyUnsupported =
    featureKey === "pageTranslation" && translationMode === "translationOnly"
  const providerOptions = useMemo(() => {
    const candidates = getSelectableProvidersForCapability(featureKey, providersConfig)
    if (!hideTranslationOnlyUnsupported) {
      return candidates
    }
    return candidates.filter((option) => providerSupportsTranslationOnlyMode(option.provider))
  }, [featureKey, providersConfig, hideTranslationOnlyUnsupported])

  const setProvider = useCallback(
    (id: string) => void setConfig(buildFeatureProvidersPatch({ [featureKey]: [id] })),
    [featureKey, setConfig],
  )

  const setProviders = useCallback(
    (ids: string[]) => {
      void setConfig(buildFeatureProvidersPatch({ [featureKey]: ids }))
    },
    [featureKey, setConfig],
  )

  return {
    providerOptions,
    provider,
    providers,
    providerConfig: getProviderConfigById(providersConfig, provider) ?? null,
    setProvider,
    setProviders,
  }
}

/**
 * `useFeatureProvider` plus the resolved configs of the selected providers — everything a
 * "feature → label with API-key warning → multi-select" row needs, however it is laid out.
 */
export function useSelectedFeatureProviders(featureKey: FeatureKey) {
  const { providerOptions, providers, setProviders, ...rest } = useFeatureProvider(featureKey)
  const selectedProviders = useMemo(
    () =>
      providers
        .map((id) => providerOptions.find((provider) => provider.id === id))
        .filter((provider) => provider !== undefined),
    [providers, providerOptions],
  )
  return { providerOptions, providers, setProviders, selectedProviders, ...rest }
}

export interface CustomActionProvidersBinding {
  /** Only the actions the user can actually trigger, so disabled ones stay out of the UI. */
  actions: SelectionToolbarCustomAction[]
  providerOptions: ProviderSelectorOption[]
  getProviderConfig: (action: SelectionToolbarCustomAction) => ProviderConfig | null
  setActionProvider: (actionId: string, provider: string) => void
}

/** Same as `useFeatureProvider`, for the custom AI actions in the selection toolbar. */
export function useCustomActionProviders(): CustomActionProvidersBinding {
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(writeConfigAtom)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)

  const providerOptions = useSelectableProviders("customAction")

  const actions = useMemo(
    () =>
      getSelectionToolbarActions(config.selectionToolbar).filter(
        (action) => action.enabled !== false,
      ),
    [config.selectionToolbar],
  )

  const setActionProvider = useCallback(
    (actionId: string, provider: string) =>
      void setConfig({
        selectionToolbar: patchSelectionToolbarAction(config.selectionToolbar, actionId, {
          provider,
        }),
      }),
    [config.selectionToolbar, setConfig],
  )

  const getProviderConfig = useCallback(
    (action: SelectionToolbarCustomAction) =>
      getProviderConfigById(providersConfig, action.provider) ?? null,
    [providersConfig],
  )

  return { actions, providerOptions, getProviderConfig, setActionProvider }
}
