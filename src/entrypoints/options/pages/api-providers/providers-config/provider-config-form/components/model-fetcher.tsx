import { Icon } from "@iconify/react"
import { useMutation } from "@tanstack/react-query"
import { useSetAtom, useStore } from "jotai"
import { useEffect, useState } from "react"
import LoadingDots from "@/components/loading-dots"
import { Button } from "@/components/ui/base-ui/button"
import { Checkbox } from "@/components/ui/base-ui/checkbox"
import { Input } from "@/components/ui/base-ui/input"
import type {
  LLMProviderConfig,
  ProtocolCompatibleLLMProviderConfig,
} from "@/types/config/provider"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { extractErrorMessage } from "@/utils/error/extract-message"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { getProviderConnectionURL } from "@/utils/providers/connection-url"
import { getProviderModelsURL } from "@/utils/providers/models-url"
import {
  modelFetcherCacheAtom,
  patchModelFetcherUiStateAtom,
  saveModelFetcherFetchResultAtom,
  settledBatchResults,
} from "../../model-fetcher-cache"
import { useModelFetcherConnectApi } from "../model-fetcher-connect-context"
import { ModelTestButton } from "./model-test-button"

interface ModelsResponse {
  object: string
  data: Array<{ id: string; object: string; created: number; owned_by: string }>
}

// Batch-testing fan-out stays deliberately small: a few in-flight requests
// look like normal user traffic, a few dozen can trip provider rate limits.
const TEST_AND_SELECT_CONCURRENCY = 3

interface ModelFetcherProps {
  providerConfig: ProtocolCompatibleLLMProviderConfig
  /**
   * Called when a model row's checkbox is toggled. Checked = the model joins
   * the provider's saved models (`model.rotationModels`), unchecked removes
   * it — selection itself is the persistence, there is no separate confirm.
   */
  onToggleFavorite: (modelId: string, favorite: boolean) => void
  /** Batch toggle for select-all / deselect-all over the visible models. */
  onToggleMany: (modelIds: string[], favorite: boolean) => void
  /**
   * Called after each successful fetch with the full deduped id list. Lets the
   * config owner reconcile the provider's saved models against fresh truth:
   * saved models the provider no longer serves would otherwise linger as
   * ghosts — invisible in this list yet still requested by rotation — and a
   * vanished primary would fail on every request until cooldown parks it.
   */
  onSyncSavedModels: (fetchedModelIds: string[]) => void
  disabled?: boolean
}

/**
 * Fetches the provider's model list and renders it inline: each row is
 * multi-selectable and can be connectivity-tested individually.
 *
 * The picker stays hidden until an API key row's "connect" is clicked; the
 * connect request carries the API key that clicked it, and this picker fetches
 * with that key and pins every row's test to it — so testing a model is the
 * real connection check, for the primary key or for whichever rotation key the
 * user just connected. A provider whose models were fetched before reopens
 * straight from the model fetcher cache instead: no hiding, no refetch.
 */
export function ModelFetcher({
  providerConfig,
  onToggleFavorite,
  onToggleMany,
  onSyncSavedModels,
  disabled,
}: ModelFetcherProps) {
  const { state: connectState } = useModelFetcherConnectApi()
  const { apiKey } = providerConfig
  const favoritedModels = providerConfig.model?.rotationModels ?? []
  const connectionURL = getProviderConnectionURL(providerConfig)
  const store = useStore()
  const saveFetchResult = useSetAtom(saveModelFetcherFetchResultAtom)
  const patchUiState = useSetAtom(patchModelFetcherUiStateAtom)
  // Restored once on mount from the per-provider cache: switching back to this
  // provider (or reopening the options page) replays the last fetch result and
  // picker state instead of starting cold. A snapshot fetched from another
  // endpoint (the provider was re-pointed since) is void.
  const [restored] = useState(() => {
    const cached = store.get(modelFetcherCacheAtom)[providerConfig.id]
    if (!cached || !connectionURL || cached.connectionURL !== connectionURL) {
      return null
    }
    return cached
  })
  const [search, setSearch] = useState(restored?.search ?? "")
  // "Selected only" filter: when on, the list shrinks to just the checked
  // models so the user can review what they picked without the haystack.
  const [onlySelected, setOnlySelected] = useState(restored?.onlySelected ?? false)
  // The key whose row's "connect" was clicked (the primary key before any
  // connect): fetched with and tested against. A restored snapshot pinned to
  // a key that has since been removed falls back to the current primary key,
  // so per-model tests never hammer a revoked credential.
  const [activeKey, setActiveKey] = useState<string | undefined>(() => {
    const restoredKey = restored?.activeKey
    if (!restoredKey) return apiKey
    return [apiKey, ...(providerConfig.apiKeys ?? [])].includes(restoredKey) ? restoredKey : apiKey
  })
  // Non-null while "test and select" is running: done / total drives the
  // button's progress label and keeps it disabled until the batch ends, and
  // per-model results drive each row's test button icon as the pool advances.
  const [testProgress, setTestProgress] = useState<{ done: number; total: number } | null>(null)
  const [batchResults, setBatchResults] = useState<Record<string, "pending" | "success" | "error">>(
    restored?.batchResults ?? {},
  )

  const mutation = useMutation({
    mutationKey: ["fetchModels", providerConfig.provider, connectionURL],
    meta: {
      errorDescription: i18n.t("options.apiProviders.form.models.fetchError"),
    },
    mutationFn: async (key: string) => {
      if (!key) {
        throw new Error(i18n.t("options.apiProviders.form.models.apiKeyRequired"))
      }

      const response = await fetch(getProviderModelsURL(providerConfig), {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (!response.ok) {
        throw new Error(await extractErrorMessage(response))
      }

      const data: ModelsResponse = await response.json()
      return data.data.map((m) => m.id)
    },
  })

  const handleFetch = (key?: string) => {
    const keyToUse = key ?? activeKey
    if (!connectionURL || !keyToUse) return
    setSearch("")
    setOnlySelected(false)
    setActiveKey(keyToUse)
    mutation.reset()
    mutation.mutate(keyToUse)
  }

  // A connect click on an API key row enables this picker and fetches the
  // provider's models with that row's key right away. Only the request id is a
  // dependency: reconnecting refetches, but editing a key afterwards must not.
  // A request restored from the cache must not fetch either — the picker shows
  // the cached list as-is; the next real connect click drops the flag.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new connect request (request id change) may fire the fetch, not key or handler identity changes
  useEffect(() => {
    if (!connectState || connectState.hydrated) return
    handleFetch(connectState.apiKey ?? apiKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectState?.requestId])

  // Every successful fetch triggers one reconciliation pass. mutation.data is
  // cleared while a refetch is pending, so this fires exactly once per fresh
  // result. The dedupe mirrors the render list but without its 1000-row
  // display cap, so pruning sees the provider's full response. The same
  // snapshot replaces the cached one, so the picker restores the fresh list on
  // the next mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the callback re-reads current form state at call time, so only a new fetch result (new array identity) may fire this
  useEffect(() => {
    if (!mutation.data) return
    const models = [...new Set(mutation.data)]
    onSyncSavedModels(models)
    saveFetchResult({ providerId: providerConfig.id, models, connectionURL, activeKey })
  }, [mutation.data])

  // Mirror the picker's transient UI state into the session cache as it
  // changes, so switching providers and back resumes exactly where the user
  // left off. Session-only by design: the localStorage mirror skips these, so
  // a fresh page never resurrects a stale search filter or half-finished batch
  // marks. "pending" entries (a batch interrupted by a provider switch) are
  // stripped — a restored row must never spin forever.
  useEffect(() => {
    patchUiState({
      providerId: providerConfig.id,
      patch: {
        search,
        onlySelected,
        batchResults: settledBatchResults(batchResults),
      },
    })
  }, [patchUiState, providerConfig.id, search, onlySelected, batchResults])

  const toggleModel = (model: string) => {
    onToggleFavorite(model, !favoritedModels.includes(model))
  }

  // Batch connectivity test over the visible models with a small worker pool.
  // Same pinned-key, pinned-model request the per-row test button sends; each
  // row's icon tracks its test live, and a passing model is checked the moment
  // it answers instead of waiting for the whole batch.
  const handleTestAndSelect = async () => {
    if (isDisabled || testProgress || visibleModels.length === 0) return
    const list = visibleModels
    setTestProgress({ done: 0, total: list.length })
    setBatchResults(Object.fromEntries(list.map((modelId) => [modelId, "pending" as const])))
    let cursor = 0
    const worker = async () => {
      while (cursor < list.length) {
        const modelId = list[cursor++]!
        try {
          await sendMessage("directTranslate", {
            text: "Hi",
            langConfig: DEFAULT_CONFIG.language,
            // Same union-literal clash as ModelTestButton: only the model slot changes.
            providerConfig: {
              ...providerConfig,
              apiKey: activeKey,
              model: { ...providerConfig.model, model: modelId },
            } as unknown as LLMProviderConfig,
          })
          setBatchResults((results) => ({ ...results, [modelId]: "success" }))
          onToggleFavorite(modelId, true)
        } catch {
          // Unreachable model: leave it unchecked and keep the batch going.
          setBatchResults((results) => ({ ...results, [modelId]: "error" }))
        }
        setTestProgress((progress) =>
          progress ? { ...progress, done: progress.done + 1 } : progress,
        )
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(TEST_AND_SELECT_CONCURRENCY, list.length) }, worker),
    )
    setTestProgress(null)
    // Rows keep their check / cross until the next batch or re-fetch, so the
    // user can scan the results at leisure.
  }

  // Hidden until a connect wakes it up — or until a cached snapshot restores
  // it (see the hydrated connect gate); nothing to fetch or test before that.
  if (!connectState) {
    return null
  }

  const isDisabled = disabled || !connectionURL || !activeKey

  // Idle state - show fetch button — unless a cached snapshot was restored,
  // in which case the picker falls straight through to the list below. Every
  // state keeps the button full-width: the fetch control sits on its own line
  // in a column flex container, so it stretches to the form column and never
  // jumps between narrow and wide.
  if (mutation.isIdle && !restored) {
    return (
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="w-full"
        onClick={() => handleFetch()}
        disabled={isDisabled}
      >
        <Icon icon="tabler:list-search" className="size-3.5" />
        {i18n.t("options.apiProviders.form.models.fetchModels")}
      </Button>
    )
  }

  // Loading state
  if (mutation.isPending) {
    return (
      <Button type="button" variant="outline" size="xs" className="w-full" disabled>
        <LoadingDots className="scale-75" />
        {i18n.t("options.apiProviders.form.models.fetchModels")}
      </Button>
    )
  }

  // Error state - show error button with retry option
  if (mutation.isError) {
    return (
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => handleFetch()}
        className="w-full text-red-500 hover:text-red-500"
      >
        <Icon icon="tabler:alert-circle" className="size-3.5" />
        {i18n.t("options.apiProviders.form.models.clickToRetry")}
      </Button>
    )
  }

  // Success state - list every model below the button, multi-selectable and
  // individually testable. A fetch from this mount wins over the restored
  // snapshot as soon as it lands. OpenAI-compatible gateways routinely return
  // 500-2000 ids, unsorted and with duplicates: dedupe + sort for a
  // deterministic list (the cap is only a pathological-input guard).
  const models = [...new Set(mutation.data ?? restored?.models ?? [])]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 1000)
  // Case-insensitive substring filter over the full fetched list, so a search
  // always covers every model even when the render cap is hit; the
  // "selected only" toggle then narrows it further to the checked models.
  const query = search.trim().toLowerCase()
  const visibleModels = models.filter((model) => {
    if (query && !model.toLowerCase().includes(query)) return false
    return !onlySelected || favoritedModels.includes(model)
  })
  const allSelected =
    visibleModels.length > 0 && visibleModels.every((model) => favoritedModels.includes(model))

  if (models.length === 0) {
    return (
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="w-full"
        onClick={() => handleFetch()}
        disabled={isDisabled}
      >
        <Icon icon="tabler:list" className="size-3.5" />
        {i18n.t("options.apiProviders.form.models.noModels")}
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="w-fit shrink-0"
          onClick={() => handleFetch()}
          disabled={isDisabled}
        >
          <Icon icon="tabler:refresh" className="size-3.5" />
          {i18n.t("options.apiProviders.form.models.fetchModels")}
        </Button>
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={i18n.t("options.apiProviders.form.models.searchPlaceholder")}
          aria-label={i18n.t("options.apiProviders.form.models.searchPlaceholder")}
          className="h-7 min-w-0 flex-1 px-2 py-0 text-xs"
        />
      </div>
      <div className="max-h-56 overflow-auto rounded-md border">
        {visibleModels.length === 0 ? (
          <div className="px-2 py-3 text-center text-sm text-muted-foreground">
            {i18n.t("options.apiProviders.form.models.noSearchResults")}
          </div>
        ) : (
          visibleModels.map((model) => (
            <div key={model} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-muted">
              <label
                htmlFor={`model-fetcher-${model}`}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
              >
                <Checkbox
                  id={`model-fetcher-${model}`}
                  checked={favoritedModels.includes(model)}
                  onCheckedChange={() => toggleModel(model)}
                />
                <span className="min-w-0 flex-1 truncate" title={model}>
                  {model}
                </span>
              </label>
              <ModelTestButton
                providerConfig={{ ...providerConfig, apiKey: activeKey }}
                modelId={model}
                externalState={batchResults[model]}
              />
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={allSelected ? "outline" : "brand"}
          size="xs"
          className="w-fit"
          disabled={visibleModels.length === 0}
          onClick={() => {
            onToggleMany(visibleModels, !allSelected)
          }}
        >
          {allSelected
            ? i18n.t("options.apiProviders.form.models.deselectAll")
            : i18n.t("options.apiProviders.form.models.selectAll")}
        </Button>
        <span className="flex-1 text-xs text-muted-foreground">
          {i18n.t("options.apiProviders.form.models.selectedCount", [
            String(visibleModels.filter((model) => favoritedModels.includes(model)).length),
            String(visibleModels.length),
          ])}
        </span>
        <label
          htmlFor="model-fetcher-only-selected"
          className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Checkbox
            id="model-fetcher-only-selected"
            checked={onlySelected}
            // No models picked yet = nothing to filter down to; once on it
            // stays enabled so deselect-all can't strand the user on an
            // empty list with a disabled, checked filter.
            disabled={favoritedModels.length === 0 && !onlySelected}
            onCheckedChange={setOnlySelected}
          />
          {i18n.t("options.apiProviders.form.models.onlySelected")}
        </label>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="w-fit shrink-0"
          disabled={isDisabled || visibleModels.length === 0 || testProgress !== null}
          onClick={handleTestAndSelect}
        >
          {testProgress ? (
            <LoadingDots className="scale-75" />
          ) : (
            <Icon icon="tabler:plug-connected-check" className="size-3.5" />
          )}
          {testProgress
            ? i18n.t("options.apiProviders.form.models.testAndSelectProgress", [
                String(testProgress.done),
                String(testProgress.total),
              ])
            : i18n.t("options.apiProviders.form.models.testAndSelect")}
        </Button>
      </div>
    </div>
  )
}
