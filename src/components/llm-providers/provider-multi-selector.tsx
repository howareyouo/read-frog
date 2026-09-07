import { IconChevronDown } from "@tabler/icons-react"
import type { ComponentProps } from "react"
import ProviderIcon from "@/components/provider-icon"
import { useTheme } from "@/components/providers/theme-provider"
import { Button } from "@/components/ui/base-ui/button"
import { Checkbox } from "@/components/ui/base-ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/base-ui/popover"
import { i18n } from "@/utils/i18n"
import type { ProviderSelectorOption } from "@/utils/providers/provider-display"
import { getProviderLogo, getProviderName } from "@/utils/providers/provider-display"
import { cn } from "@/utils/styles/utils"
import { getProviderSelectorGroups } from "./provider-selector"

/** Icons shown in the trigger before the "+N" overflow badge. */
const TRIGGER_ICON_LIMIT = 3

interface ProviderMultiSelectorProps {
  providers: ProviderSelectorOption[]
  /** Selected provider ids, in rotation order. */
  value: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
  className?: string
  triggerSize?: "sm" | "default"
  selectContentProps?: Pick<
    ComponentProps<typeof PopoverContent>,
    "container" | "positionerClassName" | "align"
  >
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id]
}

function ProviderMultiOption({
  provider,
  order,
  checked,
  onToggle,
}: {
  provider: ProviderSelectorOption
  order: number | null
  checked: boolean
  onToggle: (id: string) => void
}) {
  const { theme } = useTheme()

  return (
    // A native label makes the whole row activate the checkbox: clicking
    // anywhere outside it forwards the click to the checkbox button, while a
    // direct hit on the checkbox itself is not forwarded again (single toggle).
    // biome-ignore lint/a11y/noLabelWithoutControl: the Base UI Checkbox renders a <button> inside the label
    <label
      data-slot="provider-multi-option"
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-hidden select-none hover:bg-accent/50"
    >
      <Checkbox checked={checked} onCheckedChange={() => onToggle(provider.id)} />
      <ProviderIcon
        logo={getProviderLogo(provider, theme)}
        name={getProviderName(provider)}
        size="sm"
      />
      {order !== null && (
        <span className="ml-auto min-w-5 rounded-full bg-muted px-1.5 text-center text-xs text-muted-foreground">
          {order + 1}
        </span>
      )}
    </label>
  )
}

/**
 * Multi-select provider picker for feature provider rotation. Selection order
 * matters: requests round-robin through the chosen providers in the order they
 * were ticked, shown as a numbered badge on each selected row.
 */
export default function ProviderMultiSelector({
  providers,
  value,
  onChange,
  placeholder,
  className,
  triggerSize = "default",
  selectContentProps,
}: ProviderMultiSelectorProps) {
  const { theme } = useTheme()
  const selectedProviders = value
    .map((id) => providers.find((provider) => provider.id === id))
    .filter((provider): provider is ProviderSelectorOption => provider !== undefined)
  const providerGroups = getProviderSelectorGroups(providers)
  const allSelected = selectedProviders.length === providers.length && providers.length > 0

  const orderOf = (id: string): number | null => {
    const index = value.indexOf(id)
    return index >= 0 ? index : null
  }

  const handleToggle = (id: string) => {
    onChange(toggleId(value, id))
  }

  const handleSelectAll = () => {
    // Keep already-selected ids first so ticking "select all" appends the rest
    // instead of reshuffling the existing rotation order.
    const rest = providers.map((provider) => provider.id).filter((id) => !value.includes(id))
    onChange([...value, ...rest])
  }

  const handleClearAll = () => {
    onChange([])
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size={triggerSize === "sm" ? "sm" : "default"}
            className={cn(
              "w-full justify-between gap-1 font-normal",
              selectedProviders.length === 0 && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        {selectedProviders.length === 0 ? (
          <span className="truncate">
            {placeholder ?? i18n.t("translateService.multiSelect.selectProviders")}
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1">
            {selectedProviders.slice(0, TRIGGER_ICON_LIMIT).map((provider) => (
              <img
                key={provider.id}
                src={getProviderLogo(provider, theme)}
                alt={getProviderName(provider)}
                className="size-4 shrink-0 object-contain"
              />
            ))}
            {selectedProviders.length > TRIGGER_ICON_LIMIT && (
              <span className="text-xs text-muted-foreground">
                +{selectedProviders.length - TRIGGER_ICON_LIMIT}
              </span>
            )}
          </span>
        )}
        <IconChevronDown className="size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" {...selectContentProps} className="w-80 p-2">
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-xs text-muted-foreground">
            {selectedProviders.length > 0
              ? i18n.t("translateService.multiSelect.selectedCount", [selectedProviders.length])
              : i18n.t("translateService.multiSelect.selectProviders")}
          </span>
          <button
            type="button"
            className="text-xs text-blue-500 hover:underline"
            onClick={allSelected ? handleClearAll : handleSelectAll}
          >
            {allSelected
              ? i18n.t("translateService.multiSelect.clearAll")
              : i18n.t("translateService.multiSelect.selectAll")}
          </button>
        </div>
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {providerGroups.map((group) => (
            <div key={group.labelKey} className="flex flex-col">
              <span className="px-2 py-1 text-xs font-medium text-muted-foreground">
                {i18n.t(group.labelKey)}
              </span>
              {group.providers.map((provider) => (
                <ProviderMultiOption
                  key={provider.id}
                  provider={provider}
                  order={orderOf(provider.id)}
                  checked={value.includes(provider.id)}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          ))}
        </div>
        <p className="px-2 pt-1 text-xs text-muted-foreground">
          {i18n.t("translateService.multiSelect.rotationHint")}
        </p>
      </PopoverContent>
    </Popover>
  )
}
