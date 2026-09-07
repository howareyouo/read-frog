import { APP_NAME } from "@read-frog/definitions"
import { camelCase } from "case-anything"
import customProviderLogo from "@/assets/providers/custom-provider.svg?url&no-inline"
import deeplxLogoDark from "@/assets/providers/deeplx-dark.svg?url&no-inline"
import deeplxLogoLight from "@/assets/providers/deeplx-light.svg?url&no-inline"
import jalapenoCloudLogo from "@/assets/providers/jalapeno-cloud.png?url&no-inline"
import tensdaqLogoColor from "@/assets/providers/tensdaq-color.svg?url&no-inline"
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

export const DEFAULT_LLM_PROVIDER_MODELS: LLMProviderModels = {
  openrouter: {
    model: "x-ai/grok-4-fast:free",
  },
  jalapenocloud: {
    model: "GLM-5.2",
  },
  atlascloud: {
    model: "deepseek-ai/deepseek-v4-flash",
  },
  "openai-compatible": {
    model: CUSTOM_MODEL_PLACEHOLDER,
  },
  siliconflow: {
    model: "Qwen/Qwen3-Next-80B-A3B-Instruct",
  },
  tensdaq: {
    model: "Qwen3-30B-A3B-Instruct-2507",
  },
  volcengine: {
    model: "doubao-seed-1-6-flash-250828",
  },
  minimax: {
    model: "MiniMax-M2.7",
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
  jalapenocloud: {
    logo: () => jalapenoCloudLogo,
    name: "Jalapeno Cloud",
    website: "https://www.jalapeno-cloud.ai/readfrog",
    apiKeyUrl: "https://www.jalapeno-cloud.ai/readfrog",
    sponsor: {
      sponsoring: true,
      referUrl: "https://www.jalapeno-cloud.ai/readfrog",
      // Both default to the generic sponsor wording; Jalapeno names its actual offer instead.
      badgeI18nKey: "options.apiProviders.badges.sponsorJalapenoCloud",
      ctaI18nKey: "options.apiProviders.sponsorCtaJalapenoCloud",
    },
  },
  atlascloud: {
    logo: getLobeIconsCDNUrlFn("atlascloud"),
    name: "Atlas Cloud",
    website: "https://readfrog.s.gy/altas",
    apiKeyUrl: "https://readfrog.s.gy/altas",
    sponsor: {
      sponsoring: true,
      referUrl: "https://readfrog.s.gy/altas",
    },
  },
  "openai-compatible": {
    logo: () => customProviderLogo,
    name: "Custom Chat Complete",
    website: `${env.WXT_WEBSITE_URL}/docs/providers/openai-compatible-providers`,
  },
  openrouter: {
    logo: getLobeIconsCDNUrlFn("openrouter"),
    name: "OpenRouter",
    website: "https://openrouter.ai/",
  },
  minimax: {
    logo: getLobeIconsCDNUrlFn("minimax-color"),
    name: "MiniMax",
    website: "https://platform.minimax.io",
  },
  siliconflow: {
    logo: getLobeIconsCDNUrlFn("siliconcloud-color"),
    name: "SiliconFlow",
    website: "https://siliconflow.cn/",
  },
  tensdaq: {
    logo: () => tensdaqLogoColor,
    name: "Tensdaq",
    website: "https://dashboard.x-aio.com/zh/register?ref=c356c1daba9a4641a18e",
  },
  volcengine: {
    logo: getLobeIconsCDNUrlFn("volcengine-color"),
    name: "Volcengine",
    website: "https://www.volcengine.com/product/doubao",
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
  jalapenocloud: {
    id: "jalapenocloud-default",
    name: PROVIDER_ITEMS.jalapenocloud.name,
    enabled: true,
    provider: "jalapenocloud",
    baseURL: "https://api.jalapeno-cloud.ai/v1",
    model: DEFAULT_LLM_PROVIDER_MODELS.jalapenocloud,
    // Attribution headers are not here on purpose: they are ours to send, not the user's to
    // configure, so they live in FORCED_PROVIDER_HEADERS and never enter stored config.
    // Every Jalapeno model is a thinking model. Translation gains nothing from the reasoning
    // pass and pays for it in latency and output tokens, so it starts off — and unlike the
    // headers this is a preference, so it is written in where the user can change it.
    providerOptions: {
      chat_template_kwargs: {
        thinking: false,
      },
    },
  },
  atlascloud: {
    id: "atlascloud-default",
    name: PROVIDER_ITEMS.atlascloud.name,
    enabled: true,
    provider: "atlascloud",
    baseURL: "https://api.atlascloud.ai/v1",
    model: DEFAULT_LLM_PROVIDER_MODELS.atlascloud,
  },
  siliconflow: {
    id: "siliconflow-default",
    name: PROVIDER_ITEMS.siliconflow.name,
    enabled: true,
    provider: "siliconflow",
    baseURL: "https://api.siliconflow.cn/v1",
    model: DEFAULT_LLM_PROVIDER_MODELS.siliconflow,
  },
  tensdaq: {
    id: "tensdaq-default",
    name: PROVIDER_ITEMS.tensdaq.name,
    enabled: true,
    provider: "tensdaq",
    baseURL: "https://tensdaq-api.x-aio.com/v1",
    model: DEFAULT_LLM_PROVIDER_MODELS.tensdaq,
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
  openrouter: {
    id: "openrouter-default",
    name: PROVIDER_ITEMS.openrouter.name,
    enabled: true,
    provider: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    model: DEFAULT_LLM_PROVIDER_MODELS.openrouter,
  },
  volcengine: {
    id: "volcengine-default",
    name: PROVIDER_ITEMS.volcengine.name,
    enabled: true,
    provider: "volcengine",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    model: DEFAULT_LLM_PROVIDER_MODELS.volcengine,
  },
  minimax: {
    id: "minimax-default",
    name: PROVIDER_ITEMS.minimax.name,
    enabled: true,
    provider: "minimax",
    baseURL: "https://api.minimax.io/v1",
    model: DEFAULT_LLM_PROVIDER_MODELS.minimax,
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
export const FORCED_PROVIDER_HEADERS: Partial<Record<LLMProviderTypes, Record<string, string>>> = {
  jalapenocloud: {
    "HTTP-Referer": env.WXT_WEBSITE_URL,
    "X-Jalapeno-Title": APP_NAME,
  },
  openrouter: {
    "HTTP-Referer": env.WXT_WEBSITE_URL,
    "X-OpenRouter-Title": APP_NAME,
  },
}

export const PROVIDER_URL_PLACEHOLDERS: Partial<Record<APIProviderTypes, string>> = {
  jalapenocloud: DEFAULT_PROVIDER_CONFIG.jalapenocloud.baseURL,
  atlascloud: DEFAULT_PROVIDER_CONFIG.atlascloud.baseURL,
  siliconflow: DEFAULT_PROVIDER_CONFIG.siliconflow.baseURL,
  tensdaq: DEFAULT_PROVIDER_CONFIG.tensdaq.baseURL,
  "openai-compatible": DEFAULT_PROVIDER_CONFIG["openai-compatible"].baseURL,
  deeplx: DEFAULT_PROVIDER_CONFIG.deeplx.baseURL,
  openrouter: "https://openrouter.ai/api/v1",
  volcengine: DEFAULT_PROVIDER_CONFIG.volcengine.baseURL,
  minimax: DEFAULT_PROVIDER_CONFIG.minimax.baseURL,
}

export const DEFAULT_PROVIDER_CONFIG_LIST: ProvidersConfig = [
  DEFAULT_PROVIDER_CONFIG["google-translate"],
  DEFAULT_PROVIDER_CONFIG["microsoft-translate"],
  DEFAULT_PROVIDER_CONFIG.siliconflow,
  DEFAULT_PROVIDER_CONFIG.jalapenocloud,
  DEFAULT_PROVIDER_CONFIG.atlascloud,
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
