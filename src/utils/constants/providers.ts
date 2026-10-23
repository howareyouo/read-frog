import { camelCase } from "case-anything"
import customProviderLogo from "@/assets/providers/custom-provider.svg?url&no-inline"
import deeplxLogoDark from "@/assets/providers/deeplx-dark.svg?url&no-inline"
import deeplxLogoLight from "@/assets/providers/deeplx-light.svg?url&no-inline"
import { env } from "@/env"
import type {
  AllProviderTypes,
  APIProviderTypes,
  CustomModelOnlyProviderTypes,
  LLMProviderModels,
  LLMProviderTypes,
  ProviderConfig,
  ProviderSponsorConfig,
  ProvidersConfig,
} from "@/types/config/provider"
import {
  API_PROVIDER_TYPES,
  CUSTOM_MODEL_PLACEHOLDER,
  DEDICATED_LLM_PROVIDER_TYPES,
  isAPIProviderConfig,
  isCustomModelOnlyProvider,
  NON_API_TRANSLATE_PROVIDERS,
  NON_API_TRANSLATE_PROVIDERS_MAP,
  PROTOCOL_COMPATIBLE_LLM_PROVIDER_TYPES,
  PURE_API_PROVIDER_TYPES,
  PURE_TRANSLATE_PROVIDERS,
  TRANSLATE_PROVIDER_TYPES,
} from "@/types/config/provider"
import type { Theme } from "@/types/config/theme"
import { omit, pick } from "@/types/utils"
import { i18n } from "@/utils/i18n"
import { getLobeIconsCDNUrlFn } from "../logo"

const DEFAULT_LLM_PROVIDER_MODELS: LLMProviderModels = {
  "openai-compatible": {
    model: CUSTOM_MODEL_PLACEHOLDER,
  },
}

export const PROVIDER_ITEMS: Record<
  AllProviderTypes,
  {
    logo: (theme: Theme) => string
    name: string
    website: string
    sponsor?: ProviderSponsorConfig
    /**
     * Where someone signs up for or copies this provider's key. Only providers that set it get
     * the "Get API key" button next to the API key field — absent means no button, because most
     * providers' key pages sit behind a console we cannot link straight into.
     */
    apiKeyUrl?: string
  }
> = {
  "microsoft-translate": {
    logo: getLobeIconsCDNUrlFn("microsoft-color"),
    name: NON_API_TRANSLATE_PROVIDERS_MAP["microsoft-translate"],
    website: "https://translator.microsoft.com",
  },
  "google-translate": {
    logo: getLobeIconsCDNUrlFn("google-color"),
    name: NON_API_TRANSLATE_PROVIDERS_MAP["google-translate"],
    website: "https://translate.google.com",
  },
  deeplx: {
    logo: (theme: Theme) => (theme === "light" ? deeplxLogoLight : deeplxLogoDark),
    name: "DeepLX",
    website: "https://deeplx.owo.network/",
  },
  deepl: {
    logo: (theme: Theme) => (theme === "light" ? deeplxLogoLight : deeplxLogoDark),
    name: "DeepL",
    website: "https://www.deepl.com/pro-api",
  },
  "openai-compatible": {
    logo: () => customProviderLogo,
    name: "Custom Chat Complete",
    website: `${env.WXT_WEBSITE_URL}/docs/providers/openai-compatible-providers`,
  },
}

export const DEFAULT_PROVIDER_CONFIG = {
  "google-translate": {
    id: "google-translate-default",
    name: PROVIDER_ITEMS["google-translate"].name,
    enabled: true,
    provider: "google-translate",
  },
  "microsoft-translate": {
    id: "microsoft-translate-default",
    name: PROVIDER_ITEMS["microsoft-translate"].name,
    enabled: true,
    provider: "microsoft-translate",
  },
  "openai-compatible": {
    id: "openai-compatible-default",
    name: PROVIDER_ITEMS["openai-compatible"].name,
    enabled: true,
    provider: "openai-compatible",
    baseURL: "https://api.example.com/v1",
    model: DEFAULT_LLM_PROVIDER_MODELS["openai-compatible"],
  },
  deeplx: {
    id: "deeplx-default",
    name: PROVIDER_ITEMS.deeplx.name,
    enabled: true,
    provider: "deeplx",
    baseURL: "https://api.deeplx.org/{{apiKey}}/translate",
  },
  deepl: {
    id: "deepl-default",
    name: PROVIDER_ITEMS.deepl.name,
    enabled: true,
    provider: "deepl",
  },
} as const satisfies Record<AllProviderTypes, ProviderConfig>

export const GOOGLE_TRANSLATE_PROVIDER_ID = DEFAULT_PROVIDER_CONFIG["google-translate"].id
export const MICROSOFT_TRANSLATE_PROVIDER_ID = DEFAULT_PROVIDER_CONFIG["microsoft-translate"].id

/**
 * Headers a provider is always called with, merged over whatever the user set. The user may add
 * headers alongside these but cannot drop or rewrite them, and they never enter stored config —
 * which is also what makes them ours to change in a later release. A header a provider merely
 * starts out with belongs in `DEFAULT_PROVIDER_CONFIG[provider].headers` instead, where the user
 * owns it.
 */
export const FORCED_PROVIDER_HEADERS: Partial<Record<LLMProviderTypes, Record<string, string>>> = {}

export const PROVIDER_URL_PLACEHOLDERS: Partial<Record<APIProviderTypes, string>> = {
  "openai-compatible": DEFAULT_PROVIDER_CONFIG["openai-compatible"].baseURL,
  deeplx: DEFAULT_PROVIDER_CONFIG.deeplx.baseURL,
}

export const DEFAULT_PROVIDER_CONFIG_LIST: ProvidersConfig = [
  DEFAULT_PROVIDER_CONFIG["google-translate"],
  DEFAULT_PROVIDER_CONFIG["microsoft-translate"],
  DEFAULT_PROVIDER_CONFIG["openai-compatible"],
]

/** Resolve a provider's default description in the active interface language. */
export function getDefaultProviderDescription(providerType: APIProviderTypes): string | undefined {
  const descriptionKey = camelCase(providerType)
  const description = i18n.t(
    `options.apiProviders.providers.description.${descriptionKey}` as never,
  )
  return description || undefined
}

/**
 * Build providers for a fresh config after i18n has initialized, so descriptions are
 * persisted in the same interface language as providers created from the options page.
 */
export function buildDefaultProviderConfigList(): ProvidersConfig {
  return structuredClone(DEFAULT_PROVIDER_CONFIG_LIST).map((providerConfig) => {
    if (!isAPIProviderConfig(providerConfig)) {
      return providerConfig
    }

    const description = getDefaultProviderDescription(providerConfig.provider)
    return description ? { ...providerConfig, description } : providerConfig
  })
}

export const NON_API_TRANSLATE_PROVIDER_ITEMS = pick(PROVIDER_ITEMS, NON_API_TRANSLATE_PROVIDERS)

export const TRANSLATE_PROVIDER_ITEMS = pick(PROVIDER_ITEMS, TRANSLATE_PROVIDER_TYPES)

export const PURE_TRANSLATE_PROVIDER_ITEMS = pick(
  TRANSLATE_PROVIDER_ITEMS,
  PURE_TRANSLATE_PROVIDERS,
)

export const LLM_PROVIDER_ITEMS = omit(TRANSLATE_PROVIDER_ITEMS, PURE_TRANSLATE_PROVIDERS)

export const API_PROVIDER_ITEMS = pick(PROVIDER_ITEMS, API_PROVIDER_TYPES)

const PROVIDER_NAME_I18N_KEYS = {
  "openai-compatible": "options.apiProviders.providers.name.customChatComplete",
} as const satisfies Record<CustomModelOnlyProviderTypes, string>

export function getProviderItemName(providerType: APIProviderTypes): string {
  if (!isCustomModelOnlyProvider(providerType)) {
    return PROVIDER_ITEMS[providerType].name
  }

  return i18n.t(PROVIDER_NAME_I18N_KEYS[providerType]) || PROVIDER_ITEMS[providerType].name
}

export const PROVIDER_GROUPS = {
  builtInProviders: {
    types: DEDICATED_LLM_PROVIDER_TYPES,
    tutorialSlug: "built-in-providers",
  },
  compatibleProviders: {
    types: PROTOCOL_COMPATIBLE_LLM_PROVIDER_TYPES,
    tutorialSlug: "openai-compatible-providers",
  },
  pureTranslationProviders: {
    types: PURE_API_PROVIDER_TYPES,
    tutorialSlug: "pure-translation-providers",
  },
} as const satisfies Record<string, { types: readonly APIProviderTypes[]; tutorialSlug: string }>

export const SPECIFIC_TUTORIAL_PROVIDER_TYPES = [
  "deeplx",
  "deepl",
] as const satisfies readonly APIProviderTypes[]
