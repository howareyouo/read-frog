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
        {/* A single group renders label-free: the flat list the multi-kind
            lists used to get, just wrapped in an (invisible) SelectGroup. */}
        {providerGroups.map((group) => (
          <SelectGroup key={group.labelKey}>
            {providerGroups.length > 1 && <SelectLabel>{i18n.t(group.labelKey)}</SelectLabel>}
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
