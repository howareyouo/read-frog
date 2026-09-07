import type { LLMProviderConfig } from "@/types/config/provider"

export function resolveModelId(providerModel: LLMProviderConfig["model"]) {
  return providerModel.model.trim()
}
