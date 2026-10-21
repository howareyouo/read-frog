import { Icon } from "@iconify/react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "react-router"
import { SponsorBadge } from "@/components/badges/sponsor-badge"
import ProviderIcon from "@/components/provider-icon"
import { useTheme } from "@/components/providers/theme-provider"
import { SortableList } from "@/components/sortable-list"
import { Badge } from "@/components/ui/base-ui/badge"
import { Button } from "@/components/ui/base-ui/button"
import { Dialog, DialogTrigger } from "@/components/ui/base-ui/dialog"
import { anchoredToastManager } from "@/components/ui/base-ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/base-ui/tooltip"
import type { APIProviderConfig } from "@/types/config/provider"
import { isAPIProvider, isAPIProviderConfig } from "@/types/config/provider"
import { configAtom, configFieldsAtomMap } from "@/utils/atoms/config"
import { providerConfigAtom } from "@/utils/atoms/provider"
import { getAPIProvidersConfig, getProviderConfigById } from "@/utils/config/helpers"
import type { FeatureKey } from "@/utils/constants/feature-providers"
import {
  FEATURE_KEYS,
  getFeatureLabelI18nKey,
  getFeatureProviders,
} from "@/utils/constants/feature-providers"
import { API_PROVIDER_ITEMS } from "@/utils/constants/providers"
import { getSelectionToolbarActions } from "@/utils/custom-actions"
import { i18n } from "@/utils/i18n"
import {
  getRequestedProviderId,
  getRequestedProviderType,
  PROVIDER_CONFIG_SECTION_ID,
  shouldHighlightApiKey,
} from "@/utils/navigation"
import { ConfigItem } from "../../../components/config-item"
import { EntityEditorLayout } from "../../../components/entity-editor-layout"
import { EntityListItem } from "../../../components/entity-list-item"
import { EntityListRail } from "../../../components/entity-list-rail"
import AddProviderDialog from "./add-provider-dialog"
import { highlightedProviderFieldAtom, selectedProviderIdAtom } from "./atoms"
import { ProviderConfigForm } from "./provider-config-form"
import { addProvider } from "./utils"

/**
 * Opens the provider a deep link points at — by `?provider=` id, the one an API-key prompt
 * elsewhere on the page uses, or by `?providerType=` for links written by someone who cannot know
 * the id, such as a provider's own site. A type with no provider behind it gets one created.
 *
 * Keyed on the history entry so the same link works twice, and an id is held back until it
 * resolves so a link followed before the config loads is not dropped.
 */
function useRequestedProvider() {
  const { search, key: locationKey } = useLocation()
  const [providersConfig, setProvidersConfig] = useAtom(configFieldsAtomMap.providersConfig)
  const setSelectedProviderId = useSetAtom(selectedProviderIdAtom)
  const setHighlightedField = useSetAtom(highlightedProviderFieldAtom)
  const handledLocationRef = useRef<string | null>(null)

  useEffect(() => {
    const marker = `${locationKey}:${search}`
    if (handledLocationRef.current === marker) return

    const highlightRequestedField = () => {
      if (shouldHighlightApiKey(search)) {
        setHighlightedField("apiKey")
      }
    }

    const providerId = getRequestedProviderId(search)
    if (providerId) {
      if (!getProviderConfigById(providersConfig, providerId)) {
        return
      }

      handledLocationRef.current = marker
      setSelectedProviderId(providerId)
      highlightRequestedField()
      return
    }

    const requestedType = getRequestedProviderType(search)
    if (!requestedType || !isAPIProvider(requestedType)) return

    // Claimed before anything awaits: adding a provider rewrites the config this effect reads,
    // and React's development double-invoke runs it a second time. Either would add a duplicate.
    handledLocationRef.current = marker

    const existingProvider = getAPIProvidersConfig(providersConfig).find(
      (provider) => provider.provider === requestedType,
    )
    if (existingProvider) {
      setSelectedProviderId(existingProvider.id)
      highlightRequestedField()
      return
    }

    void addProvider(
      requestedType,
      providersConfig,
      setProvidersConfig,
      setSelectedProviderId,
    ).then(highlightRequestedField)
  }, [
    locationKey,
    search,
    providersConfig,
    setProvidersConfig,
    setSelectedProviderId,
    setHighlightedField,
  ])
}

export function ProvidersConfig() {
  const selectedProviderId = useAtomValue(selectedProviderIdAtom)
  useRequestedProvider()
  const editor = <ProviderConfigForm key={selectedProviderId} />

  return (
    <ConfigItem
      id={PROVIDER_CONFIG_SECTION_ID}
      orientation="vertical"
      title={i18n.t("options.apiProviders.configTitle")}
      description={i18n.t("options.apiProviders.description")}
    >
      <EntityEditorLayout list={<ProviderCardList />} editor={editor} />
    </ConfigItem>
  )
}

function ProviderCardList() {
  const [providersConfig, setProvidersConfig] = useAtom(configFieldsAtomMap.providersConfig)
  const apiProvidersConfig = getAPIProvidersConfig(providersConfig)
  // Derived here ONCE for the whole list instead of per card: each card used to
  // subscribe to the whole config and re-run two filters on every config write
  // (O(cards × features)); the cards now receive their slice as props.
  const config = useAtomValue(configAtom)
  const assignmentsByProviderId = useMemo(() => {
    const map = new Map<string, ProviderAssignments>()
    const customActions = getSelectionToolbarActions(config.selectionToolbar)
    for (const provider of apiProvidersConfig) {
      map.set(provider.id, {
        features: FEATURE_KEYS.filter((key) =>
          getFeatureProviders(config, key).includes(provider.id),
        ),
        customActions: customActions.filter((action) => action.provider === provider.id),
        isLanguageDetectionProvider:
          config.languageDetection.mode === "llm" &&
          config.languageDetection.provider === provider.id,
      })
    }
    return map
  }, [config, apiProvidersConfig])
  const [selectedProviderId, setSelectedProviderId] = useAtom(selectedProviderIdAtom)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const didLockInitialSelectionRef = useRef(false)

  const handleReorder = (newList: APIProviderConfig[]) => {
    const desiredOrderIds = newList.map((provider) => provider.id)
    const desiredOrderIdSet = new Set(desiredOrderIds)

    const nonApiProviders = providersConfig.filter((provider) => !isAPIProviderConfig(provider))
    const currentApiProviders = providersConfig.filter(isAPIProviderConfig)

    const apiProvidersById = new Map(
      currentApiProviders.map((provider) => [provider.id, provider] as const),
    )

    const reorderedApiProviders: APIProviderConfig[] = []
    for (const id of desiredOrderIds) {
      const provider = apiProvidersById.get(id)
      if (provider) reorderedApiProviders.push(provider)
    }

    // Preserve any API providers that appeared while dragging (e.g. config sync)
    for (const provider of currentApiProviders) {
      if (!desiredOrderIdSet.has(provider.id)) {
        reorderedApiProviders.push(provider)
      }
    }

    void setProvidersConfig([...nonApiProviders, ...reorderedApiProviders])
  }

  useEffect(() => {
    if (didLockInitialSelectionRef.current) return
    if (selectedProviderId) {
      setSelectedProviderId(selectedProviderId)
      didLockInitialSelectionRef.current = true
    }
  }, [selectedProviderId, setSelectedProviderId])

  return (
    <div className="flex flex-col gap-4">
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogTrigger
          render={
            <Button
              variant="outline"
              className="h-auto rounded-xl border-dashed border-accent-blue bg-accent-blue/8 p-3 hover:bg-accent-blue/14 dark:border-accent-blue dark:bg-accent-blue/12 dark:hover:bg-accent-blue/20"
              onClick={() => setIsAddDialogOpen(true)}
            />
          }
        >
          <div className="flex w-full items-center justify-center gap-2">
            <Icon icon="tabler:plus" className="size-4" />
            <span className="text-sm">{i18n.t("options.apiProviders.addProvider")}</span>
          </div>
        </DialogTrigger>
        <AddProviderDialog onClose={() => setIsAddDialogOpen(false)} />
      </Dialog>
      <EntityListRail>
        <SortableList
          list={apiProvidersConfig}
          setList={handleReorder}
          className="flex flex-col gap-4 pt-2"
          renderItem={(providerConfig) => (
            <ProviderCard
              providerConfig={providerConfig}
              assignments={assignmentsByProviderId.get(providerConfig.id) ?? EMPTY_ASSIGNMENTS}
            />
          )}
        />
      </EntityListRail>
    </div>
  )
}

interface ProviderAssignments {
  features: FeatureKey[]
  customActions: ReturnType<typeof getSelectionToolbarActions>
  isLanguageDetectionProvider: boolean
}

const EMPTY_ASSIGNMENTS: ProviderAssignments = {
  features: [],
  customActions: [],
  isLanguageDetectionProvider: false,
}

function ProviderCard({
  providerConfig,
  assignments,
}: {
  providerConfig: APIProviderConfig
  assignments: ProviderAssignments
}) {
  const { id, name, provider, enabled } = providerConfig
  const { theme } = useTheme()
  const [selectedProviderId, setSelectedProviderId] = useAtom(selectedProviderIdAtom)
  const setProviderConfig = useSetAtom(providerConfigAtom(id))
  const sponsor = API_PROVIDER_ITEMS[provider].sponsor
  const switchRef = useRef<HTMLButtonElement>(null)

  const {
    features: assignedFeatures,
    customActions: assignedCustomActions,
    isLanguageDetectionProvider,
  } = assignments
  const totalAssigned =
    assignedFeatures.length + assignedCustomActions.length + (isLanguageDetectionProvider ? 1 : 0)

  const handleProviderEnabledChange = (checked: boolean) => {
    if (!checked && enabled && totalAssigned > 0) {
      if (!switchRef.current) return

      anchoredToastManager.add({
        id: `provider-disable-${id}`,
        positionerProps: {
          anchor: switchRef.current,
          sideOffset: 6,
        },
        type: "error",
        title: i18n.t("options.apiProviders.form.providerInUseCannotDisable", [
          name,
          totalAssigned,
        ]),
      })
      return
    }

    void setProviderConfig({ ...providerConfig, enabled: checked })
  }

  return (
    <EntityListItem.Root
      data-provider-id={id}
      selected={selectedProviderId === id}
      onClick={() => setSelectedProviderId(id)}
    >
      <EntityListItem.Badges>
        <>
          {sponsor?.sponsoring && (
            <SponsorBadge
              labelI18nKey={sponsor.badgeI18nKey}
              className="absolute -top-2 left-2 text-[10px]"
            />
          )}
          <FeatureCountBadge count={totalAssigned}>
            {assignedFeatures.map((key) => (
              <li key={key}>{i18n.t(getFeatureLabelI18nKey(key))}</li>
            ))}
            {isLanguageDetectionProvider && (
              <li>{i18n.t("options.apiProviders.languageDetection.title")}</li>
            )}
            {assignedCustomActions.map((action) => (
              <li key={action.id}>{action.name}</li>
            ))}
          </FeatureCountBadge>
        </>
      </EntityListItem.Badges>
      <EntityListItem.Content>
        <ProviderIcon
          logo={API_PROVIDER_ITEMS[provider].logo(theme)}
          name={name}
          size="base"
          textClassName="text-sm"
        />
        <EntityListItem.Toggle
          ref={switchRef}
          aria-label={name}
          checked={enabled}
          onCheckedChange={handleProviderEnabledChange}
        />
      </EntityListItem.Content>
    </EntityListItem.Root>
  )
}

function FeatureCountBadge({ count, children }: { count: number; children: React.ReactNode }) {
  if (count === 0) {
    return null
  }

  return (
    <div className="absolute -top-2 right-2 flex items-center justify-center gap-1">
      <Tooltip>
        <TooltipTrigger render={<Badge className="cursor-default bg-blue-500" size="sm" />}>
          {i18n.t("options.apiProviders.badges.featureCount", [count])}
        </TooltipTrigger>
        <TooltipContent>
          <ul className="list-inside list-disc marker:text-green-500">{children}</ul>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
