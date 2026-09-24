import type { LangCodeISO6393 } from "@read-frog/definitions"
import type { Config, InputTranslationLang } from "@/types/config/config"
import { isLLMProviderConfig } from "@/types/config/provider"
import type { WebPageContext } from "@/types/content"
import { getDetectedCodeFromStorage, getFinalSourceCode } from "@/utils/config/languages"
import { getDocumentDescription } from "@/utils/content/metadata"
import { resolveFeatureProviderRefForRequest } from "@/utils/providers/feature-provider-resolver"
import { serializeProviderRef } from "@/utils/providers/provider-ref"
import { getCachedConfig } from "../../config/storage"
import { translateTextCore } from "./translate-text"
import { truncateWebPageContent } from "./webpage-content"
import { getOrGenerateWebPageSummary } from "./webpage-summary"

async function getConfigOrThrow(): Promise<Config> {
  const config = await getCachedConfig()
  if (!config) {
    throw new Error("No global config when translate text")
  }
  return config
}

/**
 * Lightweight webpage context for input translation.
 *
 * Deliberately does NOT use `webpage-context.ts`: the context is truncated to
 * 2000 chars anyway, so full main-content extraction is not worth the latency
 * here.
 */
async function getInputWebPagePromptContext(
  providerConfig: Config["providersConfig"][number],
  enableAIContentAware: boolean,
): Promise<WebPageContext | undefined> {
  if (!isLLMProviderConfig(providerConfig)) {
    return undefined
  }

  const webContent = truncateWebPageContent(document.body?.textContent || "")
  if (!(document.title || "").trim() || !webContent.trim()) {
    return undefined
  }

  const webSummary = await getOrGenerateWebPageSummary(
    {
      url: window.location.href,
      webTitle: document.title || "",
      webDescription: getDocumentDescription(document),
      webContent,
    },
    serializeProviderRef(providerConfig),
    enableAIContentAware,
  )

  return {
    webTitle: document.title || "",
    webDescription: getDocumentDescription(document),
    webContent,
    webSummary: webSummary ?? undefined,
  }
}

async function resolveInputLang(
  lang: InputTranslationLang,
  globalLangConfig: Config["language"],
): Promise<LangCodeISO6393> {
  if (lang === "sourceCode") {
    const detectedCode = await getDetectedCodeFromStorage()
    return getFinalSourceCode(globalLangConfig.sourceCode, detectedCode)
  }
  if (lang === "targetCode") {
    return globalLangConfig.targetCode
  }
  return lang
}

/**
 * Input translation — uses FEATURE_PROVIDER_DEFS['inputTranslation'].
 */
export async function translateTextForInput(
  text: string,
  fromLang: InputTranslationLang,
  toLang: InputTranslationLang,
): Promise<string> {
  const config = await getConfigOrThrow()
  // Round-robin across the feature's selected providers.
  const resolved = resolveFeatureProviderRefForRequest("inputTranslation", config)
  if (!resolved) {
    throw new Error(
      `No input translation provider for ids "${config.inputTranslation.providerIds.join(", ")}"`,
    )
  }
  const providerConfig = resolved.config

  const resolvedFromLang = await resolveInputLang(fromLang, config.language)
  const resolvedToLang = await resolveInputLang(toLang, config.language)

  if (resolvedFromLang === resolvedToLang) {
    return ""
  }

  const webPageContext = await getInputWebPagePromptContext(
    providerConfig,
    config.pageTranslation.enableAIContentAware,
  )

  return translateTextCore({
    text,
    langConfig: {
      sourceCode: resolvedFromLang,
      targetCode: resolvedToLang,
      level: config.language.level,
    },
    extraHashTags: [`inputTranslation:${fromLang}->${toLang}`],
    providerConfig,
    enableAIContentAware: config.pageTranslation.enableAIContentAware,
    webPageContext,
    // User-typed newlines are always meaningful.
    preserveLineBreaks: true,
  })
}
