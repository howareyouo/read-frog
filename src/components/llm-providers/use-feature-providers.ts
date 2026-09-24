import { useAtomValue, useSetAtom } from "jotai"
import { useCallback, useMemo } from "react"
import type { ProviderConfig } from "@/types/config/provider"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { configAtom, configFieldsAtomMap, writeConfigAtom } from "@/utils/atoms/config"
import { getProviderConfigById } from "@/utils/config/helpers"
import type { FeatureKey } from "@/utils/constants/feature-providers"
import {
  buildFeatureProviderIdsPatch,
  FEATURE_PROVIDER_DEFS,
} from "@/utils/constants/feature-providers"
import { getSelectionToolbarActions, patchSelectionToolbarAction } from "@/utils/custom-actions"
import type { ProviderSelectorOption } from "@/utils/providers/provider-display"
import { getSelectableProvidersForCapability } from "@/utils/providers/provider-registry"
import { providerSupportsTranslationOnlyMode } from "@/utils/providers/translation-only-gate"

export interface FeatureProviderBinding {
  providers: ProviderSelectorOption[]
  /** The primary provider — first of `providerIds`. */
  providerId: string
  providerIds: string[]
  providerConfig: ProviderConfig | null
  setProviderId: (providerId: string) => void
  setProviderIds: (providerIds: string[]) => void
}

/** Reads and writes the provider a built-in feature runs on, independent of how it is laid out. */
export function useFeatureProvider(featureKey: FeatureKey): FeatureProviderBinding {
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(writeConfigAtom)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)
  const translationMode = useAtomValue(configFieldsAtomMap.pageTranslation).mode
  const providerIds = FEATURE_PROVIDER_DEFS[featureKey].getProviderIds(config)
  const providerId = providerIds[0] ?? ""

  // Page translate in translationOnly mode cannot run on providers without
  // markup support (see translation-only-gate.ts) — hide them so the blocked
  // combination cannot be formed from a provider picker. Other features keep
  // the full list.
  const hideTranslationOnlyUnsupported =
    featureKey === "pageTranslation" && translationMode === "translationOnly"
  const providers = useMemo(() => {
    const candidates = getSelectableProvidersForCapability(featureKey, providersConfig)
    if (!hideTranslationOnlyUnsupported) {
      return candidates
    }
    return candidates.filter((option) => providerSupportsTranslationOnlyMode(option.provider))
  }, [featureKey, providersConfig, hideTranslationOnlyUnsupported])

  const setProviderId = useCallback(
    (id: string) => void setConfig(buildFeatureProviderIdsPatch({ [featureKey]: [id] })),
    [featureKey, setConfig],
  )

  const setProviderIds = useCallback(
    (ids: string[]) => {
      void setConfig(buildFeatureProviderIdsPatch({ [featureKey]: ids }))
    },
    [featureKey, setConfig],
  )

  return {
    providers,
    providerId,
    providerIds,
    providerConfig: getProviderConfigById(providersConfig, providerId) ?? null,
    setProviderId,
    setProviderIds,
  }
}

export interface CustomActionProvidersBinding {
  /** Only the actions the user can actually trigger, so disabled ones stay out of the UI. */
  actions: SelectionToolbarCustomAction[]
  providers: ProviderSelectorOption[]
  getProviderConfig: (action: SelectionToolbarCustomAction) => ProviderConfig | null
  setActionProviderId: (actionId: string, providerId: string) => void
}

/** Same as `useFeatureProvider`, for the custom AI actions in the selection toolbar. */
export function useCustomActionProviders(): CustomActionProvidersBinding {
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(writeConfigAtom)
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)

  const providers = useMemo(
    () => getSelectableProvidersForCapability("customAction", providersConfig),
    [providersConfig],
  )

  const actions = useMemo(
    () =>
      getSelectionToolbarActions(config.selectionToolbar).filter(
        (action) => action.enabled !== false,
      ),
    [config.selectionToolbar],
  )

  const setActionProviderId = useCallback(
    (actionId: string, providerId: string) =>
      void setConfig({
        selectionToolbar: patchSelectionToolbarAction(config.selectionToolbar, actionId, {
          providerId,
        }),
      }),
    [config.selectionToolbar, setConfig],
  )

  const getProviderConfig = useCallback(
    (action: SelectionToolbarCustomAction) =>
      getProviderConfigById(providersConfig, action.providerId) ?? null,
    [providersConfig],
  )

  return { actions, providers, getProviderConfig, setActionProviderId }
}
