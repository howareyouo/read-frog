import type { JSONValue } from "ai"

type OpenAIReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh"

interface OpenAIGPT5ReasoningEffortPolicy {
  pattern: RegExp
  supportedValues: readonly OpenAIReasoningEffort[]
  recommendedValue?: OpenAIReasoningEffort
}

/**
 * Default "model" for the generic OpenAI-compatible provider (Custom Chat
 * Complete). Its endpoints expose arbitrary model ids, so there is no honest
 * preset default: this sentinel keeps the model slot schema-valid until the
 * user picks a real id from the fetched models list. It is deliberately NOT a
 * preset in `LLM_PROVIDER_MODELS`, so it never appears as a dropdown option —
 * the selector shows an unset hint instead.
 */
export const CUSTOM_MODEL_PLACEHOLDER = "use-custom-model"

export const LLM_PROVIDER_MODELS = {
  // No presets on purpose: a generic OpenAI-compatible gateway can expose any
  // model ids, so the only way to pick one is the live models list (ModelFetcher)
  // or a custom id — the sentinel default lives in CUSTOM_MODEL_PLACEHOLDER.
  "openai-compatible": [],
} as const

export const NON_API_TRANSLATE_PROVIDERS = ["google-translate", "microsoft-translate"] as const
export const NON_API_TRANSLATE_PROVIDERS_MAP: Record<
  (typeof NON_API_TRANSLATE_PROVIDERS)[number],
  string
> = {
  "google-translate": "Google Translate",
  "microsoft-translate": "Microsoft Translator",
}

export const PURE_TRANSLATE_PROVIDERS = [
  "google-translate",
  "microsoft-translate",
  "deeplx",
  "deepl",
] as const

const OPENAI_GPT5_REASONING_EFFORT_POLICIES: OpenAIGPT5ReasoningEffortPolicy[] = [
  {
    pattern: /^gpt-5\.4-pro$/i,
    supportedValues: ["medium", "high", "xhigh"],
    recommendedValue: "medium",
  },
  {
    pattern: /^gpt-5\.2-pro$/i,
    supportedValues: ["medium", "high", "xhigh"],
    recommendedValue: "medium",
  },
  {
    pattern: /^gpt-5-pro$/i,
    supportedValues: ["high"],
    recommendedValue: "high",
  },
  {
    pattern: /^(?:gpt-5\.5|gpt-5\.4|gpt-5\.4-mini|gpt-5\.4-nano)$/i,
    supportedValues: ["none", "low", "medium", "high", "xhigh"],
    recommendedValue: "none",
  },
  {
    pattern: /^gpt-5\.2$/i,
    supportedValues: ["none", "low", "medium", "high", "xhigh"],
    recommendedValue: "none",
  },
  {
    pattern: /^(?:gpt-5\.1|gpt-5\.1-codex|gpt-5\.1-codex-mini)$/i,
    supportedValues: ["none", "low", "medium", "high"],
    recommendedValue: "none",
  },
  {
    pattern: /^(?:gpt-5|gpt-5-mini|gpt-5-nano|gpt-5-codex)$/i,
    supportedValues: ["minimal", "low", "medium", "high"],
    recommendedValue: "minimal",
  },
  {
    pattern:
      /^(?:gpt-5-chat-latest|gpt-5\.1-chat-latest|gpt-5\.2-chat-latest|gpt-5\.3-chat-latest)$/i,
    supportedValues: [],
  },
]

const OPENAI_GPT5_RECOMMENDED_MODEL_OPTIONS: Array<{
  pattern: RegExp
  options: Record<string, JSONValue>
}> = OPENAI_GPT5_REASONING_EFFORT_POLICIES.flatMap(({ pattern, recommendedValue }) => {
  if (recommendedValue === undefined) {
    return []
  }

  return [
    {
      pattern,
      options: { reasoningEffort: recommendedValue },
    },
  ]
})

export function getOpenAIGPT5ReasoningEffortPolicy(
  model: string,
): OpenAIGPT5ReasoningEffortPolicy | undefined {
  return OPENAI_GPT5_REASONING_EFFORT_POLICIES.find(({ pattern }) => pattern.test(model))
}

/**
 * Model options configuration.
 * Flat list design: first match wins, more specific patterns should be placed first.
 * Options are matched by model name, not by provider.
 */
export const LLM_MODEL_OPTIONS: Array<{
  pattern: RegExp
  options: Record<string, JSONValue>
}> = [
  // Gemini - specific patterns first
  // The versionless aliases track the newest generation, which uses thinkingLevel;
  // the pro tier does not accept "minimal".
  {
    pattern: /^gemini-pro-latest$/i,
    options: { thinkingConfig: { thinkingLevel: "low", includeThoughts: false } },
  },
  {
    pattern: /^gemini-flash(?:-lite)?-latest$/i,
    options: { thinkingConfig: { thinkingLevel: "minimal", includeThoughts: false } },
  },
  {
    pattern: /^gemini-3(?:\.\d+)?-.*?(?:-preview(?:-customtools)?)?$/i,
    options: { thinkingConfig: { thinkingLevel: "minimal", includeThoughts: false } },
  },
  {
    pattern: /^gemini-2\.5-/i,
    options: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } },
  },
  {
    // Default for all other Gemini models
    pattern: /^gemini-/i,
    options: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } },
  },

  // Claude - disable thinking
  {
    pattern: /^claude-/i,
    options: { thinking: { type: "disabled" } },
  },

  // OpenAI reasoning models - use the lowest supported reasoning effort
  {
    pattern: /^(?:o1|o3|o4-mini)(?:-|$)/i,
    options: { reasoningEffort: "minimal" },
  },

  // OpenAI GPT-5 defaults use the lowest supported reasoning effort per model.
  // GPT-5 chat-latest variants are intentionally omitted because their docs do not advertise reasoning.effort.
  ...OPENAI_GPT5_RECOMMENDED_MODEL_OPTIONS,

  // Grok reasoning-capable text models - keep effort at the lowest supported level.
  // Non-reasoning Grok variants are intentionally omitted because they do not need reasoning options.
  {
    pattern: /^(?:grok-4\.3|grok-4\.20-0309-reasoning)$/i,
    options: { reasoningEffort: "low" },
  },

  // OpenAI-compatible reasoning models exposed by Groq/Cerebras and similar providers
  {
    pattern: /^(?:openai\/)?gpt-oss-(?:20|120)b$/i,
    options: { reasoningEffort: "none" },
  },

  // Volcengine Doubao Seed models - disable thinking by default.
  // Keep the version suffix optional because non-Volcengine providers may expose the same model family without it.
  {
    pattern:
      /(?:^|\/)doubao-seed-(?:code-preview|1[.-](?:6(?:-(?:flash|vision))?|8)|2[.-]0-(?:lite|mini|pro|code-preview))(?:-\d{6})?$/i,
    options: { thinking: { type: "disabled" } },
  },

  // DeepSeek reasoning models - disable thinking by default
  {
    pattern: /(?:^|\/)deepseek-(?:reasoner|v4-(?:flash|pro))$/i,
    options: { thinking: { type: "disabled" } },
  },

  // Cohere reasoning models - disable thinking by default
  {
    pattern: /^command-a-reasoning(?:-.+)?$/i,
    options: { thinking: { type: "disabled" } },
  },

  // MiniMax reasoning-capable models - disable thinking/history by default.
  // Keep this provider-agnostic because recommendation matching is model-name based.
  {
    pattern: /(?:^|\/)minimax-m(?:2(?:[.-].*)?|3)$/i,
    options: { thinking: { type: "disabled" }, reasoningHistory: "disabled" },
  },

  // Fireworks reasoning-focused models - disable thinking/history by default
  {
    pattern: /^accounts\/fireworks\/models\/(?:kimi-k2(?:[a-z0-9.-].*)?|minimax-m2(?:[.-].*)?)$/i,
    options: { thinking: { type: "disabled" }, reasoningHistory: "disabled" },
  },

  // Kimi K2 models - disable thinking/history by default.
  // Keep instruct variants untouched; they should not receive Moonshot's `thinking` options.
  // Keep this broad because recommendation matching is model-name based rather than provider-scoped.
  {
    pattern: /(?:^|\/)kimi-k2(?!-instruct(?:[a-z0-9.-].*)?$)(?:[a-z0-9.-].*)?$/i,
    options: { thinking: { type: "disabled" }, reasoningHistory: "disabled" },
  },

  // Namespaced Qwen3 models - disable reasoning by default.
  // Keep this before the broad Qwen rule so OpenAI-compatible Qwen3 ids can use reasoningEffort.
  {
    pattern: /(?:^|\/)qwen\/qwen3(?!.*[/.-](?:thinking|qwq)(?:[/.-]|$))[a-z0-9.-]*$/i,
    options: { reasoningEffort: "none" },
  },

  // Qwen models - disable thinking by default.
  // Keep this broad because recommendation matching is model-name based rather than provider-scoped.
  // Exclude Cerebras-style `qwen-3-*` ids; they do not support Alibaba's `enableThinking`.
  // Keep explicit thinking-only variants (for example `qwq-*` and `*-thinking`) untouched.
  {
    pattern: /(?:^|\/)qwen(?!-3-)(?!.*[/.-](?:thinking|qwq)(?:[/.-]|$)).*$/i,
    options: { enableThinking: false },
  },

  // GLM models - disable thinking (compatibility issues)
  {
    pattern: /(?:^|\/)GLM-/i,
    options: { thinking: { type: "disabled" } },
  },
]
