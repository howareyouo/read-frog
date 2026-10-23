import { z } from "zod"
import type {
  APIProviderTypes,
  DedicatedLLMProviderTypes,
  LLMProviderTypes,
  NonAPIProviderTypes,
  OpenAICompatibleLLMProviderTypes,
  ProtocolCompatibleLLMProviderTypes,
  PureAPIProviderTypes,
  TopLevelReasoningProviderTypes,
  TranslateProviderTypes,
} from "./constants"
import { LLM_PROVIDER_MODELS } from "./constants"

/* ──────────────────────────────
  Providers config schema
  ────────────────────────────── */

/**
 * The model slot shared by every LLM provider. `model` is a free-form id — it
 * is set from the provider's own models endpoint (ModelFetcher) or from the
 * built-in presets — so it cannot be constrained to a per-provider enum. The
 * built-in lists in `LLM_PROVIDER_MODELS` only seed defaults and dropdown
 * candidates.
 */
export const providerModelSchema = z.object({
  model: z.string().min(1),
  rotationModels: z.array(z.string()).optional(),
})

// Base schema without models
export const baseProviderConfigSchema = z.strictObject({
  id: z.string().nonempty(),
  name: z.string().nonempty(),
  description: z.string().optional(),
  enabled: z.boolean(),
})

export const baseAPIProviderConfigSchema = baseProviderConfigSchema.extend({
  apiKey: z.string().optional(),
  /**
   * Additional API keys rotated with `apiKey` on every request, so one key's
   * per-minute budget is not the whole provider's. `apiKey` stays the primary
   * (and the one every pre-existing reader expects); these are extras.
   */
  apiKeys: z.array(z.string()).optional(),
  baseURL: z.string().optional(),
  temperature: z.number().min(0).optional(),
  providerOptions: z.record(z.string(), z.any()).optional(),
  headers: z.record(z.string(), z.any()).optional(),
})

export const baseOpenAICompatibleLLMProviderConfigSchema = baseAPIProviderConfigSchema.extend({
  baseURL: z.string(),
})

// Providers removed from the preset lists (openrouter, minimax, siliconflow,
// tensdaq, volcengine, atlascloud, jalapenocloud) still appear in configs
// stored by older versions. They speak the same OpenAI-compatible protocol, so
// downgrading keeps them working verbatim — baseURL, model and keys survive —
// instead of failing validation and resetting the whole config.
const LEGACY_HOSTED_LLM_PROVIDER_TYPES = [
  "jalapenocloud",
  "atlascloud",
  "openrouter",
  "minimax",
  "siliconflow",
  "tensdaq",
  "volcengine",
] as const

function downgradeLegacyHostedProviders(providers: unknown): unknown[] {
  if (!Array.isArray(providers)) {
    return []
  }

  return providers.map((providerConfig) => {
    if (
      providerConfig &&
      typeof providerConfig === "object" &&
      LEGACY_HOSTED_LLM_PROVIDER_TYPES.includes(
        (providerConfig as { provider?: unknown }).provider as never,
      )
    ) {
      return { ...providerConfig, provider: "openai-compatible" }
    }

    return providerConfig
  })
}

const llmProviderConfigSchemaList = [
  baseOpenAICompatibleLLMProviderConfigSchema.extend({
    provider: z.literal("openai-compatible"),
    model: providerModelSchema,
  }),
] as const

const apiProviderConfigSchemaList = [
  ...llmProviderConfigSchemaList,
  baseAPIProviderConfigSchema.extend({
    provider: z.literal("deeplx"),
  }),
  baseAPIProviderConfigSchema.extend({
    provider: z.literal("deepl"),
  }),
] as const

export const providerConfigSchemaList = [
  ...apiProviderConfigSchemaList,
  baseProviderConfigSchema.extend({
    provider: z.literal("google-translate"),
  }),
  baseProviderConfigSchema.extend({
    provider: z.literal("microsoft-translate"),
  }),
] as const

export const llmProviderConfigItemSchema = z.discriminatedUnion(
  "provider",
  llmProviderConfigSchemaList,
)
export const apiProviderConfigItemSchema = z.discriminatedUnion(
  "provider",
  apiProviderConfigSchemaList,
)
export const providerConfigItemSchema = z.discriminatedUnion("provider", providerConfigSchemaList)

export const providersConfigSchema = z
  .preprocess(downgradeLegacyHostedProviders, z.array(providerConfigItemSchema))
  .superRefine((providers, ctx) => {
    const idSet = new Set<string>()
    providers.forEach((provider, index) => {
      if (idSet.has(provider.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate provider id "${provider.id}"`,
          path: [index, "id"],
        })
      }
      idSet.add(provider.id)
    })

    const nameSet = new Set<string>()
    providers.forEach((provider, index) => {
      if (nameSet.has(provider.name)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate provider name "${provider.name}"`,
          path: [index, "name"],
        })
      }
      nameSet.add(provider.name)
    })
  })
export type ProvidersConfig = z.infer<typeof providersConfigSchema>
export type ProviderConfig = ProvidersConfig[number]
export type NonAPIProviderConfig = Extract<ProviderConfig, { provider: NonAPIProviderTypes }>
export type PureProviderConfig = Extract<ProviderConfig, { provider: PureAPIProviderTypes }>
export type APIProviderConfig = Extract<ProviderConfig, { provider: APIProviderTypes }>
export type PureAPIProviderConfig = Extract<ProviderConfig, { provider: PureAPIProviderTypes }>
export type LLMProviderConfig = Extract<ProviderConfig, { provider: LLMProviderTypes }>
export type TranslateProviderConfig = Extract<ProviderConfig, { provider: TranslateProviderTypes }>
export type OpenAICompatibleLLMProviderConfig = Extract<
  ProviderConfig,
  { provider: OpenAICompatibleLLMProviderTypes }
>
export type ProtocolCompatibleLLMProviderConfig = Extract<
  ProviderConfig,
  { provider: ProtocolCompatibleLLMProviderTypes }
>
export type DedicatedLLMProviderConfig = Extract<
  ProviderConfig,
  { provider: DedicatedLLMProviderTypes }
>
export type TopLevelReasoningProviderConfig = Extract<
  LLMProviderConfig,
  { provider: TopLevelReasoningProviderTypes }
>

/* ──────────────────────────────
  unified llm model config helpers
  ────────────────────────────── */

type SchemaShape<M extends Record<string, readonly string[]>> = {
  [K in keyof M]: typeof providerModelSchema
}

function buildProviderModelsSchema<M extends Record<string, readonly string[]>>(models: M) {
  return z.object(
    // Keep key names and types when building schema dynamically.
    (Object.keys(models) as (keyof M)[]).reduce(
      (acc, key) => {
        acc[key] = providerModelSchema
        return acc
      },
      {} as SchemaShape<M>,
    ),
  )
}

export const llmProviderModelsSchema = buildProviderModelsSchema(LLM_PROVIDER_MODELS)
export type LLMProviderModels = z.infer<typeof llmProviderModelsSchema>
