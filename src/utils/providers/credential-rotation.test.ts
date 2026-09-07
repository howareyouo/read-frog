import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { LLMProviderConfig } from "@/types/config/provider"
import {
  clearProviderCooldown,
  isProviderCoolingDown,
  markProviderCoolingDown,
} from "@/utils/providers/provider-cooldown"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"
import {
  classifyCredentialFailure,
  credentialCooldownRecoveryMs,
  hasAvailableCredential,
  listProviderApiKeys,
  listProviderModelIds,
  markCredentialCoolingDown,
  pickNextCredential,
} from "./credential-rotation"

// `model` stays untyped: the union validates model literals per provider, but
// this fixture is cast wholesale below anyway.
type ProviderConfigOverrides = Partial<{
  [K in keyof LLMProviderConfig]: K extends "model" ? Record<string, unknown> : LLMProviderConfig[K]
}>

function makeProviderConfig(overrides: ProviderConfigOverrides = {}): LLMProviderConfig {
  return {
    id: "prov-1",
    enabled: true,
    provider: "openai-compatible",
    name: "Test",
    baseURL: "https://example.com/v1",
    apiKey: "key-a",
    model: {
      model: "gpt-4o-mini",
    },
    ...overrides,
  } as unknown as LLMProviderConfig
}

const rateLimit = (retryAfterMs?: number) =>
  attachRequestErrorMeta(new Error("429 Too Many Requests"), { statusCode: 429, retryAfterMs })

const accessDenied = () =>
  attachRequestErrorMeta(new Error("401 unauthorized"), { statusCode: 401 })

beforeEach(() => clearProviderCooldown())
afterEach(() => clearProviderCooldown())

describe("listProviderApiKeys / listProviderModelIds", () => {
  it("puts the primary key first and appends the extras", () => {
    const config = makeProviderConfig({ apiKeys: ["key-b", "key-c"] })
    expect(listProviderApiKeys(config)).toEqual(["key-a", "key-b", "key-c"])
  })

  it("trims, drops empties and dedupes across primary and extras", () => {
    const config = makeProviderConfig({ apiKey: " key-a ", apiKeys: ["", "key-a", " key-b "] })
    expect(listProviderApiKeys(config)).toEqual(["key-a", "key-b"])
  })

  it("works without any key at all", () => {
    const config = makeProviderConfig({ apiKey: undefined, apiKeys: undefined })
    expect(listProviderApiKeys(config)).toEqual([])
  })

  it("joins the resolved model id with the rotation extras, deduped", () => {
    const config = makeProviderConfig({
      model: {
        model: " my-custom-model ",
        rotationModels: ["my-custom-model", "deepseek-chat"],
      },
    })
    expect(listProviderModelIds(config)).toEqual(["my-custom-model", "deepseek-chat"])
  })
})

describe("pickNextCredential", () => {
  it("rotates keys and models independently, starting from the primary ones", () => {
    const config = makeProviderConfig({
      apiKeys: ["key-b", "key-c"],
      model: { model: "gpt-4o-mini", rotationModels: ["m2"] },
    })

    expect(pickNextCredential(config)).toEqual({ apiKey: "key-a", modelId: "gpt-4o-mini" })
    expect(pickNextCredential(config)).toEqual({ apiKey: "key-b", modelId: "m2" })
    expect(pickNextCredential(config)).toEqual({ apiKey: "key-c", modelId: "gpt-4o-mini" })
  })

  it("returns undefined dimensions when nothing is configured, not null", () => {
    // Most providers have one key and one model: the rotation must be a no-op
    // that still hands back a usable (key-less) credential.
    const config = makeProviderConfig({ apiKey: undefined, apiKeys: undefined })
    expect(pickNextCredential(config)).toEqual({ apiKey: undefined, modelId: "gpt-4o-mini" })
  })

  it("skips a cooling key and a cooling model", () => {
    const config = makeProviderConfig({
      apiKeys: ["key-b"],
      model: { model: "gpt-4o-mini", rotationModels: ["m2"] },
    })
    markProviderCoolingDown(`api-key\u0000prov-1\u0000key-a`, "rate-limit")
    markProviderCoolingDown(`model\u0000prov-1\u0000gpt-4o-mini`, "rate-limit")

    expect(pickNextCredential(config)).toEqual({ apiKey: "key-b", modelId: "m2" })
  })

  it("returns null once every key is cooling, even with models left", () => {
    const config = makeProviderConfig({ apiKeys: ["key-b"] })
    markCredentialCoolingDown(config, { apiKey: "key-a", modelId: "gpt-4o-mini" }, "rate-limit")
    markCredentialCoolingDown(config, { apiKey: "key-b", modelId: "gpt-4o-mini" }, "rate-limit")

    expect(pickNextCredential(config)).toBeNull()
    expect(hasAvailableCredential(config)).toBe(false)
  })

  it("returns null once every model is cooling, even with keys left", () => {
    const config = makeProviderConfig({
      model: { model: "gpt-4o-mini", rotationModels: ["m2"] },
    })
    markProviderCoolingDown(`model\u0000prov-1\u0000gpt-4o-mini`, "rate-limit")
    markProviderCoolingDown(`model\u0000prov-1\u0000m2`, "rate-limit")

    expect(pickNextCredential(config)).toBeNull()
  })
})

describe("markCredentialCoolingDown", () => {
  it("parks the key and the model that served the request", () => {
    const config = makeProviderConfig({ apiKeys: ["key-b"] })
    markCredentialCoolingDown(config, { apiKey: "key-a", modelId: "gpt-4o-mini" }, "rate-limit")

    expect(isProviderCoolingDown(`api-key\u0000prov-1\u0000key-a`)).toBe(true)
    expect(isProviderCoolingDown(`model\u0000prov-1\u0000gpt-4o-mini`)).toBe(true)
    expect(isProviderCoolingDown(`api-key\u0000prov-1\u0000key-b`)).toBe(false)
    // A different provider's identical key is untouched.
    expect(isProviderCoolingDown(`api-key\u0000other\u0000key-a`)).toBe(false)
  })

  it("does not park anything when the credential has no key or model", () => {
    const config = makeProviderConfig({ apiKey: undefined, apiKeys: undefined })
    markCredentialCoolingDown(config, { modelId: "gpt-4o-mini" }, "access-denied")

    expect(isProviderCoolingDown(`model\u0000prov-1\u0000gpt-4o-mini`)).toBe(true)
  })
})

describe("classifyCredentialFailure", () => {
  it("sees rate limits and hard denials, but not timeouts", () => {
    expect(classifyCredentialFailure(rateLimit())).toEqual({ reason: "rate-limit" })
    expect(classifyCredentialFailure(accessDenied())).toEqual({ reason: "access-denied" })
    expect(classifyCredentialFailure(new Error("Task timed out after 20000ms"))).toBeNull()
  })
})

describe("credentialCooldownRecoveryMs", () => {
  it("reports the soonest recovery among the provider's credentials", () => {
    const config = makeProviderConfig({ apiKeys: ["key-b"] })
    markCredentialCoolingDown(config, { apiKey: "key-a" }, "rate-limit", 60_000)
    markCredentialCoolingDown(config, { apiKey: "key-b" }, "rate-limit", 12_000)

    expect(credentialCooldownRecoveryMs(config)).toBe(12_000)
  })

  it("is 0 when nothing is cooling", () => {
    expect(credentialCooldownRecoveryMs(makeProviderConfig())).toBe(0)
  })
})
