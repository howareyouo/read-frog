import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai"
import { useEffect, useMemo, useRef, useState } from "react"
import { toastManager } from "@/components/ui/base-ui/toast"
import type { APIProviderConfig, ProvidersConfig } from "@/types/config/provider"
import {
  isAPIProviderConfig,
  isLLMProvider,
  isNonAPIProvider,
  isTranslateProvider,
} from "@/types/config/provider"
import { configAtom, configFieldsAtomMap, writeConfigAtom } from "@/utils/atoms/config"
import { providerConfigAtom } from "@/utils/atoms/provider"
import {
  computeLanguageDetectionFallbackAfterDeletion,
  computeProviderFallbacksAfterDeletion,
  computeSelectionToolbarCustomActionFallbacksAfterDeletion,
  findFeatureMissingProvider,
} from "@/utils/config/helpers"
import {
  buildFeatureProvidersPatch,
  getFeatureLabelI18nKey,
} from "@/utils/constants/feature-providers"
import { getSelectionToolbarActions } from "@/utils/custom-actions"
import { i18n } from "@/utils/i18n"
import { getProviderConnectionURL } from "@/utils/providers/connection-url"
import { EntityEditor } from "../../../../components/entity-editor"
import { selectedProviderIdAtom } from "../atoms"
import { modelFetcherCacheAtom, removeModelFetcherCacheAtom } from "../model-fetcher-cache"
import { CustomProviderEditor, ProviderEditor, useProviderForm } from "../provider-editor"
import { duplicateProvider } from "../utils"
import {
  type ModelFetcherConnectApi,
  ModelFetcherConnectContext,
  type ModelFetcherConnectRequest,
} from "./model-fetcher-connect-context"

export function ProviderConfigForm() {
  const selectedProviderId = useAtomValue(selectedProviderIdAtom)
  const providerConfig = useAtomValue(providerConfigAtom(selectedProviderId ?? ""))

  if (!providerConfig || !isAPIProviderConfig(providerConfig)) {
    return null
  }

  return <EditableProviderConfig key={providerConfig.id} providerConfig={providerConfig} />
}

function EditableProviderConfig({ providerConfig }: { providerConfig: APIProviderConfig }) {
  const setSelectedProviderId = useSetAtom(selectedProviderIdAtom)
  const [currentProviderConfig, setProviderConfig] = useAtom(providerConfigAtom(providerConfig.id))
  const [allProvidersConfig, setAllProvidersConfig] = useAtom(configFieldsAtomMap.providersConfig)
  const setConfig = useSetAtom(writeConfigAtom)
  // Read config imperatively inside the delete handler instead of subscribing:
  // this component re-renders on every config write already (via the two atoms
  // above), and a third whole-config subscription would only widen that blast
  // radius. `config` is only needed inside async handlers, never during render.
  const store = useStore()
  // Config written by our own submit — the effect below must not reset the form
  // back to it, or characters typed during the submit debounce get reverted.
  const lastSubmittedConfigRef = useRef<APIProviderConfig | null>(null)
  const form = useProviderForm(providerConfig, async (nextProviderConfig) => {
    lastSubmittedConfigRef.current = nextProviderConfig
    await setProviderConfig(nextProviderConfig)
  })

  // Transient "connect" gate shared by the API key rows and the model picker:
  // clicking 连接 on a key row asks the picker below to fetch and show the
  // provider's model list, so per-model tests replace the old one-shot
  // connection probe.
  //
  // Seeded from the model fetcher cache on mount: a provider whose models were
  // already fetched reopens with its cached list instead of starting
  // unconnected, so switching providers (or the whole page) never costs a
  // refetch. The seeded request is marked `hydrated` so the picker restores
  // the snapshot instead of refiring the fetch, and the gate is only valid
  // while the provider still points at the endpoint the snapshot came from.
  const removeFetcherCacheEntry = useSetAtom(removeModelFetcherCacheAtom)
  const [connectState, setConnectState] = useState<ModelFetcherConnectRequest | null>(() => {
    const cached = store.get(modelFetcherCacheAtom)[providerConfig.id]
    if (!cached || cached.connectionURL !== getProviderConnectionURL(providerConfig)) {
      return null
    }
    return { requestId: 0, apiKey: cached.activeKey, hydrated: true }
  })
  const modelFetcherConnectApi = useMemo<ModelFetcherConnectApi>(
    () => ({
      state: connectState,
      connect: (apiKey?: string) =>
        setConnectState((prev) => ({ requestId: (prev?.requestId ?? 0) + 1, apiKey })),
    }),
    [connectState],
  )

  useEffect(() => {
    if (!currentProviderConfig || !isAPIProviderConfig(currentProviderConfig)) return
    // Only external changes (another UI surface writing the same provider)
    // need a reset; our own submit round-trips the exact values the form
    // already holds, and resetting here is what turned every keystroke into a
    // full re-validation + remount cycle.
    const lastSubmitted = lastSubmittedConfigRef.current
    if (lastSubmitted && JSON.stringify(lastSubmitted) === JSON.stringify(currentProviderConfig)) {
      return
    }
    form.reset(currentProviderConfig)
  }, [currentProviderConfig, form])

  const chooseNextProviderConfig = (providersConfig: ProvidersConfig) => {
    const firstProvider = providersConfig.find((provider) => !isNonAPIProvider(provider.provider))
    return firstProvider ?? providersConfig[0]
  }

  const handleDuplicate = async () => {
    await duplicateProvider(
      providerConfig,
      allProvidersConfig,
      setAllProvidersConfig,
      setSelectedProviderId,
    )
  }

  const handleDelete = async () => {
    const config = store.get(configAtom)
    const updatedAllProviders = allProvidersConfig.filter(
      (provider) => provider.id !== providerConfig.id,
    )

    const unsatisfied = findFeatureMissingProvider(updatedAllProviders, config)
    if (unsatisfied) {
      // Name the feature. The block is worth nothing if the user cannot tell
      // which slot it is protecting — and it fires for switched-off features
      // too, whose stored provider would otherwise be left dangling.
      toastManager.add({
        type: "error",
        title: i18n.t("options.apiProviders.form.featureWouldLoseProvider", [
          unsatisfied === "languageDetection"
            ? i18n.t("options.apiProviders.languageDetection.title")
            : i18n.t(getFeatureLabelI18nKey(unsatisfied)),
        ]),
      })
      return
    }

    const updatedSelectionToolbar = computeSelectionToolbarCustomActionFallbacksAfterDeletion(
      providerConfig.id,
      config,
      updatedAllProviders,
    )
    const hasAffectedCustomActions = getSelectionToolbarActions(config.selectionToolbar).some(
      (action) => action.provider === providerConfig.id,
    )

    if (hasAffectedCustomActions && !updatedSelectionToolbar) {
      toastManager.add({
        type: "error",
        title: i18n.t("options.apiProviders.form.atLeastOneLLMProvider"),
      })
      return
    }

    const fallbacks = computeProviderFallbacksAfterDeletion(
      providerConfig.id,
      config,
      updatedAllProviders,
    )
    let patch = buildFeatureProvidersPatch(fallbacks)
    if (updatedSelectionToolbar) {
      patch = {
        ...patch,
        selectionToolbar: updatedSelectionToolbar,
      }
    }

    const languageDetectionFallback = computeLanguageDetectionFallbackAfterDeletion(
      providerConfig.id,
      config,
      updatedAllProviders,
    )
    if (languageDetectionFallback !== null) {
      patch = {
        ...patch,
        languageDetection: {
          ...config.languageDetection,
          provider: languageDetectionFallback,
        },
      }
    }

    if (Object.keys(patch).length > 0) {
      await setConfig(patch)
    }

    await setAllProvidersConfig(updatedAllProviders)
    // The provider is gone: its cached model list would otherwise linger and
    // come back should a future provider ever reuse the id.
    removeFetcherCacheEntry(providerConfig.id)
    const nextProvider = chooseNextProviderConfig(updatedAllProviders)
    if (nextProvider) {
      setSelectedProviderId(nextProvider.id)
    }
  }

  const providerType = providerConfig.provider
  const hasTranslationModelFields = isTranslateProvider(providerType) && isLLMProvider(providerType)
  const hasAdvancedFields = isLLMProvider(providerType)

  return (
    <ModelFetcherConnectContext value={modelFetcherConnectApi}>
      <CustomProviderEditor.Provider
        providerConfig={providerConfig}
        form={form}
        duplicate={handleDuplicate}
        delete={handleDelete}
      >
        <ProviderEditor.Form>
          <EntityEditor.Root className="min-h-0">
            <EntityEditor.Body className="min-h-0 flex-1 overflow-y-auto">
              <ProviderEditor.ConfigHeader />
              <ProviderEditor.NameField />
              <ProviderEditor.DescriptionField />
              <ProviderEditor.ConnectionFields />
              {hasTranslationModelFields && <ProviderEditor.TranslationModelFields />}
              {hasAdvancedFields && <ProviderEditor.AdvancedFields />}
            </EntityEditor.Body>
            <EntityEditor.Footer>
              <ProviderEditor.DuplicateButton />
              <ProviderEditor.DeleteButton />
            </EntityEditor.Footer>
          </EntityEditor.Root>
        </ProviderEditor.Form>
      </CustomProviderEditor.Provider>
    </ModelFetcherConnectContext>
  )
}
