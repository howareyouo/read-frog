import { atom } from "jotai"
import { atomFamily } from "jotai-family"
import type { PartialDeep } from "type-fest"
import type { LLMProviderConfig, ProviderConfig } from "@/types/config/provider"
import { llmProviderConfigItemSchema, providerConfigItemSchema } from "@/types/config/provider"
import { deepmerge } from "@/utils/merge"
import { resolveProviderRefForCapability } from "@/utils/providers/provider-registry"
import { getProviderConfigById } from "../config/helpers"
import type { FeatureKey } from "../constants/feature-providers"
import { getPrimaryFeatureProvider } from "../constants/feature-providers"
import { configAtom, configFieldsAtomMap } from "./config"

export const featureProviderRefAtom = atomFamily((featureKey: FeatureKey) =>
  atom((get) => {
    const config = get(configAtom)
    // Non-request consumers read the primary provider; requests rotate through
    // the full selection via resolveFeatureProviderRefForRequest instead.
    const providerId = getPrimaryFeatureProvider(config, featureKey)
    return resolveProviderRefForCapability(featureKey, config.providersConfig, providerId)
  }),
)

// Generic provider config atom family that accepts a name parameter
export const providerConfigAtom = atomFamily((id: string) =>
  atom(
    (get) => {
      const providersConfig = get(configFieldsAtomMap.providersConfig)
      return getProviderConfigById(providersConfig, id)
    },
    async (get, set, newProviderConfig: ProviderConfig) => {
      const providersConfig = get(configFieldsAtomMap.providersConfig)

      const updatedProviders = providersConfig.map((provider) =>
        provider.id === id ? newProviderConfig : provider,
      )

      await set(configFieldsAtomMap.providersConfig, updatedProviders)
    },
  ),
)

export function updateLLMProviderConfig(
  config: LLMProviderConfig,
  updates: PartialDeep<LLMProviderConfig>,
): LLMProviderConfig {
  return llmProviderConfigItemSchema.parse(deepmerge(config, updates))
}

export function updateProviderConfig(
  config: ProviderConfig,
  updates: PartialDeep<ProviderConfig>,
): ProviderConfig {
  return providerConfigItemSchema.parse(deepmerge(config, updates))
}
