import type { SerializableProviderRef } from "@/utils/providers/provider-ref"

export interface BackgroundGenerateTextPayload {
  providerRef: SerializableProviderRef
  instructions: string
  prompt: string
  maxRetries?: number
}

export interface BackgroundGenerateTextResponse {
  text: string
}
