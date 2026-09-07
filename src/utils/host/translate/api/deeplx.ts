import type { LangCodeISO6391 } from "@read-frog/definitions"
import type { ProviderConfig } from "@/types/config/provider"
import type { TranslationTextFormat } from "@/types/config/translate"
import { DEFAULT_PROVIDER_CONFIG } from "@/utils/constants/providers"
import { httpFetch } from "@/utils/request/http-fetch"

type DeepLXProviderConfig = Extract<ProviderConfig, { provider: "deeplx" }>
const API_KEY_PLACEHOLDER_RE = /\{\{apiKey\}\}/g

export async function deeplxTranslate(
  sourceText: string,
  fromLang: LangCodeISO6391 | "auto",
  toLang: LangCodeISO6391,
  providerConfig: DeepLXProviderConfig,
  options?: { textFormat?: TranslationTextFormat; signal?: AbortSignal },
): Promise<string> {
  const baseURL = providerConfig.baseURL || DEFAULT_PROVIDER_CONFIG.deeplx.baseURL
  const apiKey = providerConfig.apiKey

  if (!baseURL) {
    throw new Error("DeepLX baseURL is not configured")
  }

  const formatLang = (lang: LangCodeISO6391 | "auto") => {
    if (lang === "auto") return "auto"
    let formattedLang = lang.toUpperCase()
    if (formattedLang === "ZH-TW") formattedLang = "ZH-HANT"
    return formattedLang
  }

  const url = buildDeepLXUrl(baseURL, apiKey)

  const requestBody = JSON.stringify({
    text: sourceText,
    source_lang: formatLang(fromLang),
    target_lang: formatLang(toLang),
    ...(options?.textFormat === "html" ? { tag_handling: "html" } : {}),
  })

  const fetchResponse = await fetchDirect(url, requestBody, options?.signal)

  return parseDeepLXResponse(fetchResponse)
}

async function fetchDirect(url: string, body: string, signal?: AbortSignal) {
  return await httpFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    },
    "DeepLX translation",
  )
}

async function parseDeepLXResponse(resp: {
  ok: boolean
  status: number
  statusText: string
  text: () => Promise<string>
  json: () => Promise<any>
}) {
  try {
    const result = await resp.json()
    if (typeof result?.data !== "string") {
      throw new TypeError("Unexpected response format from DeepLX translation API")
    }
    return result.data
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse DeepLX translation response: ${message}`, { cause: error })
  }
}

export function buildDeepLXUrl(baseURL: string, apiKey?: string): string {
  if (baseURL.includes("{{apiKey}}")) {
    const normalizedApiKey = apiKey?.trim()
    if (!normalizedApiKey) {
      throw new Error("API key is required when using {{apiKey}} placeholder in DeepLX baseURL")
    }
    return baseURL.replace(API_KEY_PLACEHOLDER_RE, normalizedApiKey)
  }

  return baseURL
}
