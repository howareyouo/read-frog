import { langCodeISO6393Schema, langLevel } from "@read-frog/definitions"
import { z } from "zod"
import { FEATURE_KEYS, FEATURE_PROVIDER_DEFS } from "@/utils/constants/feature-providers"
import {
  MAX_SELECTION_OVERLAY_OPACITY,
  MIN_SELECTION_OVERLAY_OPACITY,
} from "@/utils/constants/selection"
import {
  doesProviderSupportsCapability,
  getProviderIdsForCapability,
} from "@/utils/providers/provider-registry"
import { languageDetectionConfigSchema } from "./language-detection"
import { providersConfigSchema } from "./provider"
import {
  selectionToolbarBuiltInActionsSchema,
  selectionToolbarCustomActionsSchema,
} from "./selection-toolbar"
import { siteRulesConfigSchema } from "./site-rules"
import { videoSubtitlesSchema } from "./subtitles"
import { pageTranslationShortcutSchema, translateConfigSchema } from "./translate"

// Language schema
const languageSchema = z.object({
  sourceCode: langCodeISO6393Schema.or(z.literal("auto")),
  targetCode: langCodeISO6393Schema,
  level: langLevel,
})

const selectionToolbarFeatureSchema = z.object({
  enabled: z.boolean(),
  providerIds: z.array(z.string()).default([]),
  shortcut: pageTranslationShortcutSchema,
})

// Text selection toolbar schema
const selectionToolbarSchema = z.object({
  enabled: z.boolean(),
  disabledSelectionToolbarPatterns: z.array(z.string()),
  opacity: z.number().min(MIN_SELECTION_OVERLAY_OPACITY).max(MAX_SELECTION_OVERLAY_OPACITY),
  features: z.object({
    translate: selectionToolbarFeatureSchema,
  }),
  builtInActions: selectionToolbarBuiltInActionsSchema,
  customActions: selectionToolbarCustomActionsSchema,
})

// beta experience schema
const betaExperienceSchema = z.object({
  enabled: z.boolean(),
})

// context menu schema
const contextMenuSchema = z.object({
  enabled: z.boolean(),
})

// input translation language selector: 'sourceCode', 'targetCode', or fixed language code
const inputTranslationLangSchema = z.union([
  z.literal("sourceCode"),
  z.literal("targetCode"),
  langCodeISO6393Schema,
])

// input translation schema (triple-space trigger)
const inputTranslationSchema = z.object({
  enabled: z.boolean(),
  providerIds: z.array(z.string()).default([]),
  fromLang: inputTranslationLangSchema,
  toLang: inputTranslationLangSchema,
  enableCycle: z.boolean(),
  timeThreshold: z.number().min(100).max(1000),
})

// Export types for use in components
export type InputTranslationLang = z.infer<typeof inputTranslationLangSchema>

// site control schema
const siteControlSchema = z.object({
  mode: z.enum(["blacklist", "whitelist"]),
  blacklistPatterns: z.array(z.string()),
  whitelistPatterns: z.array(z.string()),
})

// Interface language for the extension UI, independent of the browser language.
// "auto" follows the browser UI language; explicit values are the supported locales.
// MUST stay in sync with SUPPORTED_UI_LOCALES in `@/utils/i18n/resources` and `src/locales/`.
// `.default("auto")` is load-bearing: it lets configs stored before this field existed still
// parse successfully, avoiding the destructive fallback-to-DEFAULT_CONFIG path in
// `writeConfigAtom` / `initializeConfig` during the upgrade window.
const uiLanguageSchema = z.enum(["auto", "en", "zh-CN"]).default("auto")
export type UiLanguage = z.infer<typeof uiLanguageSchema>

// Complete config schema
export const configSchema = z
  .object({
    language: languageSchema,
    providersConfig: providersConfigSchema,
    pageTranslation: translateConfigSchema,
    languageDetection: languageDetectionConfigSchema,
    selectionToolbar: selectionToolbarSchema,
    betaExperience: betaExperienceSchema,
    contextMenu: contextMenuSchema,
    inputTranslation: inputTranslationSchema,
    videoSubtitles: videoSubtitlesSchema,
    siteControl: siteControlSchema,
    siteRules: siteRulesConfigSchema,
    uiLanguage: uiLanguageSchema,
  })
  .superRefine((data, ctx) => {
    for (const featureKey of FEATURE_KEYS) {
      const def = FEATURE_PROVIDER_DEFS[featureKey]

      // Every selected id must be a usable provider for the feature; ids the
      // user removes from providersConfig are pruned by the UI, but a stale id
      // could otherwise silently survive in the rotation.
      def.getProviderIds(data).forEach((providerId, index) => {
        if (
          !doesProviderSupportsCapability(featureKey, data.providersConfig, providerId, {
            requireEnable: true,
          })
        ) {
          ctx.addIssue({
            code: "invalid_value",
            values: getProviderIdsForCapability(featureKey, data.providersConfig, {
              requireEnable: true,
            }),
            message: `Invalid provider id "${providerId}".`,
            path: [...def.providerIdsConfigPath, index],
          })
        }
      })
    }

    // Validate languageDetection: when mode is "llm", providerId must be a valid enabled LLM provider
    if (data.languageDetection.mode === "llm") {
      const ldProviderId = data.languageDetection.providerId
      if (!ldProviderId) {
        ctx.addIssue({
          code: "custom",
          message: `Language detection mode is "llm" but no providerId is configured.`,
          path: ["languageDetection", "providerId"],
        })
      } else if (
        // Capability-based, like the FEATURE_KEYS loop above, rather than a
        // providersConfig lookup: Built-in AI is never a row in
        // providersConfig, so requiring one there is what used to make a
        // hosted provider fail validation and reset the whole config.
        !doesProviderSupportsCapability("languageDetection", data.providersConfig, ldProviderId, {
          requireEnable: true,
        })
      ) {
        ctx.addIssue({
          code: "invalid_value",
          values: getProviderIdsForCapability("languageDetection", data.providersConfig, {
            requireEnable: true,
          }),
          message: `Invalid provider id "${ldProviderId}".`,
          path: ["languageDetection", "providerId"],
        })
      }
    }

    const actionProviderEntries = [
      {
        providerId: data.selectionToolbar.builtInActions.dictionary.providerId,
        path: ["selectionToolbar", "builtInActions", "dictionary", "providerId"] as const,
      },
      ...data.selectionToolbar.customActions.map((action, index) => ({
        providerId: action.providerId,
        path: ["selectionToolbar", "customActions", index, "providerId"] as const,
      })),
    ]

    actionProviderEntries.forEach(({ providerId, path }) => {
      // Empty means the built-in Dictionary ships unassigned (no LLM provider
      // on a fresh profile); it only starts failing when it blocks deletion.
      if (providerId === "") return
      if (
        !doesProviderSupportsCapability("customAction", data.providersConfig, providerId, {
          requireEnable: true,
        })
      ) {
        ctx.addIssue({
          code: "invalid_value",
          values: getProviderIdsForCapability("customAction", data.providersConfig, {
            requireEnable: true,
          }),
          message: `Invalid provider id "${providerId}".`,
          path: [...path],
        })
      }
    })
  })

export type Config = z.infer<typeof configSchema>
