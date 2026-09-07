import type { ComponentProps } from "react"
import ProviderIcon from "@/components/provider-icon"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { isLLMProviderConfig, isPureTranslateProviderConfig } from "@/types/config/provider"
import type { Theme } from "@/types/config/theme"
import { i18n } from "@/utils/i18n"
import type { ProviderSelectorOption } from "@/utils/providers/provider-display"
import { getProviderLogo, getProviderName } from "@/utils/providers/provider-display"
import { useTheme } from "../providers/theme-provider"

type ProviderSelectorLabelKey = "translateService.llmModels" | "translateService.normalTranslator"
type ProviderSelectorTriggerSize = ComponentProps<typeof SelectTrigger>["size"]

export interface ProviderSelectorGroup {
  labelKey: ProviderSelectorLabelKey
  providers: ProviderSelectorOption[]
}

interface ProviderSelectorProps {
  providers: ProviderSelectorOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
  triggerSize?: ProviderSelectorTriggerSize
  selectContentProps?: Pick<
    ComponentProps<typeof SelectContent>,
    "container" | "positionerClassName" | "align"
  >
}

export function getProviderSelectorGroups(
  providers: ProviderSelectorOption[],
): ProviderSelectorGroup[] {
  const llmProviders = providers.filter(isLLMProviderConfig)
  const pureTranslateProviders = providers.filter(isPureTranslateProviderConfig)

  const groups: ProviderSelectorGroup[] = [
    { labelKey: "translateService.llmModels", providers: llmProviders },
    { labelKey: "translateService.normalTranslator", providers: pureTranslateProviders },
  ]

  return groups.filter((group) => group.providers.length > 0)
}

export default function ProviderSelector({
  providers,
  value,
  onChange,
  placeholder,
  className,
  triggerSize = "default",
  selectContentProps,
}: ProviderSelectorProps) {
  const { theme } = useTheme()
  const currentProvider = providers.find((p) => p.id === value)
  const providerGroups = getProviderSelectorGroups(providers)

  if (providerGroups.length > 1) {
    return (
      <GroupedSelect
        providerGroups={providerGroups}
        currentProvider={currentProvider}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
        triggerSize={triggerSize}
        selectContentProps={selectContentProps}
        theme={theme}
      />
    )
  }

  return (
    <UngroupedSelect
      providers={providers}
      currentProvider={currentProvider}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      triggerSize={triggerSize}
      selectContentProps={selectContentProps}
      theme={theme}
    />
  )
}

/**
 * Base UI calls the `<SelectValue>` children function with `null` when the
 * select has no value, which happens here whenever the configured provider id
 * is missing from `providers` (provider deleted, disabled, or filtered out).
 */
function renderProviderValue(
  provider: ProviderSelectorOption | null,
  theme: Theme,
  placeholder: string | undefined,
) {
  if (!provider) {
    return placeholder ?? ""
  }
  return (
    <ProviderIcon
      logo={getProviderLogo(provider, theme)}
      name={getProviderName(provider)}
      size="sm"
    />
  )
}

function GroupedSelect({
  providerGroups,
  currentProvider,
  onChange,
  placeholder,
  className,
  triggerSize,
  theme,
  selectContentProps,
}: {
  providerGroups: ProviderSelectorGroup[]
  currentProvider: ProviderSelectorOption | undefined
  onChange: (id: string) => void
  placeholder?: string
  className?: string
  triggerSize: ProviderSelectorTriggerSize
  selectContentProps?: Pick<
    ComponentProps<typeof SelectContent>,
    "container" | "positionerClassName" | "align"
  >
  theme: Theme
}) {
  return (
    <Select<ProviderSelectorOption>
      value={currentProvider}
      onValueChange={(provider) => {
        if (!provider) return
        onChange(provider.id)
      }}
      itemToStringValue={(p) => p.id}
    >
      <SelectTrigger className={className} size={triggerSize}>
        <SelectValue placeholder={placeholder}>
          {(provider) => renderProviderValue(provider, theme, placeholder)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent {...selectContentProps}>
        {providerGroups.map((group) => (
          <SelectGroup key={group.labelKey}>
            <SelectLabel>{i18n.t(group.labelKey)}</SelectLabel>
            {group.providers.map((provider) => (
              <SelectItem key={provider.id} value={provider}>
                <ProviderIcon
                  logo={getProviderLogo(provider, theme)}
                  name={getProviderName(provider)}
                  size="sm"
                />
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

function UngroupedSelect({
  providers,
  currentProvider,
  onChange,
  placeholder,
  className,
  triggerSize,
  theme,
  selectContentProps,
}: {
  providers: ProviderSelectorOption[]
  currentProvider: ProviderSelectorOption | undefined
  onChange: (id: string) => void
  placeholder?: string
  className?: string
  triggerSize: ProviderSelectorTriggerSize
  selectContentProps?: Pick<
    ComponentProps<typeof SelectContent>,
    "container" | "positionerClassName" | "align"
  >
  theme: Theme
}) {
  return (
    <Select<ProviderSelectorOption>
      value={currentProvider}
      onValueChange={(provider) => {
        if (!provider) return
        onChange(provider.id)
      }}
      itemToStringValue={(p) => p.id}
      disabled={providers.length === 0}
    >
      <SelectTrigger className={className} size={triggerSize}>
        <SelectValue placeholder={placeholder}>
          {(provider) => renderProviderValue(provider, theme, placeholder)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent {...selectContentProps}>
        <SelectGroup>
          {providers.map((provider) => (
            <SelectItem key={provider.id} value={provider}>
              <ProviderIcon
                logo={getProviderLogo(provider, theme)}
                name={getProviderName(provider)}
                size="sm"
              />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
