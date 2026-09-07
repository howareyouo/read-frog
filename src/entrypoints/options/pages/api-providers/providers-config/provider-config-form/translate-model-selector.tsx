import { useSelector } from "@tanstack/react-store"
import { useSetAtom } from "jotai"
import { toastManager } from "@/components/ui/base-ui/toast"
import type { APIProviderConfig } from "@/types/config/provider"
import {
  isLLMProviderConfig,
  isProtocolCompatibleLLMProviderConfig,
  llmProviderConfigItemSchema,
} from "@/types/config/provider"
import { providerConfigAtom } from "@/utils/atoms/provider"
import { i18n } from "@/utils/i18n"
import { reconcileSavedModels } from "@/utils/providers/saved-models"
import { ModelFetcher } from "./components/model-fetcher"
import { withForm } from "./form"

export const TranslateModelSelector = withForm({
  ...{ defaultValues: {} as APIProviderConfig },
  render: function Render({ form }) {
    const providerConfig = useSelector(form.store, (state) => state.values)
    const setProviderConfig = useSetAtom(providerConfigAtom(providerConfig.id))
    if (!isLLMProviderConfig(providerConfig)) return null

    // Checking a model in the fetch list persists it into `rotationModels`
    // (the saved-models list the credential rotation also draws from).
    // Reads the CURRENT form values, not the render-time closure: the batch
    // "test and select" fires favorite toggles back-to-back, and building from
    // a stale list would make each write clobber the previous ones.
    const setFavorites = (selectedModels: string[], favorite: boolean) => {
      const currentConfig = form.store.state.values
      if (!isLLMProviderConfig(currentConfig)) return
      const currentFavorited = currentConfig.model.rotationModels ?? []
      const nextRotationModels = favorite
        ? [...new Set([...currentFavorited, ...selectedModels])]
        : currentFavorited.filter((model) => !selectedModels.includes(model))
      try {
        // Build the next config directly instead of via updateLLMProviderConfig:
        // its deepmerge concatenates arrays, so a deselection would be silently
        // re-merged with the old list and never removed.
        void setProviderConfig(
          llmProviderConfigItemSchema.parse({
            ...currentConfig,
            model: {
              ...currentConfig.model,
              // The primary always tracks the first selected model —
              // selection is the single source of truth. This promotes the
              // first favorite off the placeholder sentinel on a fresh
              // provider, and re-pins the primary when unchecking removes
              // the model it pointed at. Nothing selected → keep the
              // current primary; there is nothing to derive from.
              ...(nextRotationModels[0] !== undefined ? { model: nextRotationModels[0] } : {}),
              rotationModels: nextRotationModels,
            },
          }),
        )
      } catch (error) {
        toastManager.add({
          type: "error",
          title: error instanceof Error ? error.message : "Failed to update configuration",
        })
      }
    }

    // After each successful fetch, overwrite `rotationModels` with its
    // intersection with the fetched list and re-pin the primary to the first
    // selected model (see reconcileSavedModels — fetch time is the only
    // moment the provider's real model list is known). Same current-store
    // read as setFavorites: the fetch result can land while other writes are
    // in flight.
    const syncSavedModels = (fetchedModelIds: string[]) => {
      const currentConfig = form.store.state.values
      if (!isLLMProviderConfig(currentConfig) || !currentConfig.model) return
      const sync = reconcileSavedModels(currentConfig.model, fetchedModelIds)
      if (!sync) return
      try {
        // Direct build, not updateLLMProviderConfig — same deepmerge-
        // concatenates-arrays trap as setFavorites: pruned entries must be
        // removed, not re-merged back.
        void setProviderConfig(
          llmProviderConfigItemSchema.parse({
            ...currentConfig,
            model: sync.model,
          }),
        )
      } catch (error) {
        toastManager.add({
          type: "error",
          title: error instanceof Error ? error.message : "Failed to update configuration",
        })
        return
      }
      if (sync.prunedCount > 0) {
        toastManager.add({
          type: "success",
          title: i18n.t("options.apiProviders.form.models.staleModelsRemoved", [
            String(sync.prunedCount),
          ]),
        })
      }
      if (sync.primaryReplaced) {
        toastManager.add({
          type: "success",
          title: i18n.t("options.apiProviders.form.models.primaryModelReplaced", [
            sync.model.model,
          ]),
        })
      }
    }

    // Model choice is made by checking rows in the ModelFetcher list (saved
    // into `rotationModels`, whose first entry is the primary model), so
    // there is deliberately no model dropdown here anymore. The provider
    // options recommendation trigger lives on the "Provider Options" heading
    // further down — same concern, same place.
    return (
      isProtocolCompatibleLLMProviderConfig(providerConfig) && (
        <ModelFetcher
          providerConfig={providerConfig}
          onToggleFavorite={(modelId, favorite) => setFavorites([modelId], favorite)}
          onToggleMany={setFavorites}
          onSyncSavedModels={syncSavedModels}
        />
      )
    )
  },
})
