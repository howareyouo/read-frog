import { IconPlus } from "@tabler/icons-react"
import { useAtom, useSetAtom } from "jotai"
import ProviderIcon from "@/components/provider-icon"
import { useTheme } from "@/components/providers/theme-provider"
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/base-ui/dialog"
import { API_PROVIDER_TYPES, type APIProviderTypes } from "@/types/config/provider"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import {
  API_PROVIDER_ITEMS,
  getDefaultProviderDescription,
  getProviderItemName,
} from "@/utils/constants/providers"
import { i18n } from "@/utils/i18n"
import { selectedProviderIdAtom } from "./atoms"
import { addProvider } from "./utils"

export default function AddProviderDialog({ onClose }: { onClose: () => void }) {
  const [providersConfig, setProvidersConfig] = useAtom(configFieldsAtomMap.providersConfig)
  const setSelectedProviderId = useSetAtom(selectedProviderIdAtom)

  const handleAddProvider = async (providerType: APIProviderTypes) => {
    await addProvider(providerType, providersConfig, setProvidersConfig, setSelectedProviderId)
    onClose()
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{i18n.t("options.apiProviders.dialog.title")}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-1">
        {API_PROVIDER_TYPES.map((providerType) => (
          <ProviderOptionRow
            key={providerType}
            providerType={providerType}
            onAdd={handleAddProvider}
          />
        ))}
      </div>
    </DialogContent>
  )
}

function ProviderOptionRow({
  providerType,
  onAdd,
}: {
  providerType: APIProviderTypes
  onAdd: (providerType: APIProviderTypes) => void
}) {
  const { theme } = useTheme()
  const description = getDefaultProviderDescription(providerType)

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left hover:bg-muted/70"
      onClick={() => onAdd(providerType)}
    >
      <ProviderIcon logo={API_PROVIDER_ITEMS[providerType].logo(theme)} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {getProviderItemName(providerType)}
        </span>
        {description && (
          <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      <IconPlus className="size-4 flex-shrink-0 text-muted-foreground" />
    </button>
  )
}
