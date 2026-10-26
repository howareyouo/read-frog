import { useSelector } from "@tanstack/react-store"
import { useCallback } from "react"
import { HelpTooltip } from "@/components/help-tooltip"
import type { APIProviderConfig } from "@/types/config/provider"
import { isLLMProviderConfig } from "@/types/config/provider"
import { i18n } from "@/utils/i18n"
import {
  AutosavedJsonCodeEditorField,
  type JsonEditorParseResult,
} from "./components/autosaved-json-code-editor-field"
import { parseJsonObject, stringifyJsonField } from "./components/json-field-parsing"
import { withForm } from "./form"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseHeadersJson(input: string): JsonEditorParseResult<Record<string, unknown>> {
  const base = parseJsonObject(input)
  if (!base.valid || base.value === undefined) {
    return base
  }
  if (
    !isPlainObject(base.value) ||
    Object.values(base.value).some((value) => typeof value !== "string")
  ) {
    return { valid: false, error: i18n.t("options.apiProviders.form.invalidJson") }
  }
  return base
}

const EXAMPLE_HEADERS_PLACEHOLDER = {
  "X-Custom-Header": "value",
}

export const ProviderHeadersField = withForm({
  ...{ defaultValues: {} as APIProviderConfig },
  render: function Render({ form }) {
    const providerConfig = useSelector(form.store, (state) => state.values)
    const isLLMProvider = isLLMProviderConfig(providerConfig)

    const handleHeadersCommit = useCallback(
      (value: Record<string, unknown> | undefined) => {
        form.setFieldValue("headers", value)
      },
      [form],
    )

    const handleSubmit = useCallback(() => form.handleSubmit(), [form])

    if (!isLLMProvider) {
      return null
    }

    // Only ever an example now: headers a provider starts with are seeded into its config, so
    // they show up as real editable values rather than as a hint the user has to retype. Forced
    // headers are deliberately absent — they are sent regardless, and offering them here would
    // invite edits that go nowhere.
    const placeholderText = JSON.stringify(EXAMPLE_HEADERS_PLACEHOLDER, null, 2)

    return (
      <AutosavedJsonCodeEditorField
        value={providerConfig.headers}
        resetKey={providerConfig.id}
        syncSignal={providerConfig.headers}
        parse={parseHeadersJson}
        serialize={stringifyJsonField}
        onCommit={handleHeadersCommit}
        onSubmit={handleSubmit}
        editorAriaLabel="provider-headers-editor"
        placeholder={placeholderText}
        label={
          <div className="flex items-center gap-1.5">
            <span>{i18n.t("options.apiProviders.form.headers")}</span>
            <HelpTooltip>{i18n.t("options.apiProviders.form.headersHint")}</HelpTooltip>
          </div>
        }
      />
    )
  },
})
