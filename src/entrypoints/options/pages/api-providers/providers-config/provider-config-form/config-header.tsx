import ProviderIcon from "@/components/provider-icon"
import { useTheme } from "@/components/providers/theme-provider"
import { env } from "@/env"
import type { APIProviderTypes } from "@/types/config/provider"
import {
  getProviderItemName,
  PROVIDER_GROUPS,
  PROVIDER_ITEMS,
  SPECIFIC_TUTORIAL_PROVIDER_TYPES,
} from "@/utils/constants/providers"
import { i18n } from "@/utils/i18n"

export function ConfigHeader({ providerType }: { providerType: APIProviderTypes }) {
  const tutorialUrl = getHowToConfigureURL(providerType)
  const { theme } = useTheme()
  const providerItem = PROVIDER_ITEMS[providerType]

  return (
    <div className="flex items-start justify-between">
      <a
        href={providerItem.website}
        className="flex items-center gap-2"
        target="_blank"
        rel="noreferrer"
      >
        <ProviderIcon
          logo={providerItem.logo(theme)}
          name={getProviderItemName(providerType)}
          size="base"
          className="group hover:cursor-pointer"
          textClassName="font-medium group-hover:text-link"
        />
      </a>
      {tutorialUrl && (
        <a
          href={tutorialUrl}
          className="text-xs text-link hover:opacity-90"
          target="_blank"
          rel="noreferrer"
        >
          {i18n.t("options.apiProviders.howToConfigure")}
        </a>
      )}
    </div>
  )
}

function getHowToConfigureURL(providerType: APIProviderTypes): string | undefined {
  if (SPECIFIC_TUTORIAL_PROVIDER_TYPES.includes(providerType)) {
    return `${env.WXT_WEBSITE_URL}/docs/providers/${providerType}`
  }
  const groupSlug = getProviderGroupSlug(providerType)
  if (!groupSlug) return undefined

  return `${env.WXT_WEBSITE_URL}/docs/providers/${groupSlug}`
}

function getProviderGroupSlug(providerType: APIProviderTypes): string | undefined {
  for (const group of Object.values(PROVIDER_GROUPS)) {
    if ((group.types as readonly APIProviderTypes[]).includes(providerType)) {
      return group.tutorialSlug
    }
  }
  return undefined
}
