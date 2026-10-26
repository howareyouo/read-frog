import { i18n } from "@/utils/i18n"
import type { JsonEditorParseResult } from "./autosaved-json-code-editor-field"

/** Empty input means the field is cleared; anything else must parse. */
export function parseJsonObject(input: string): JsonEditorParseResult<Record<string, unknown>> {
  if (!input.trim()) {
    return { valid: true, value: undefined }
  }
  try {
    return { valid: true, value: JSON.parse(input) }
  } catch {
    return { valid: false, error: i18n.t("options.apiProviders.form.invalidJson") }
  }
}

export function stringifyJsonField(value: unknown): string {
  return value ? JSON.stringify(value, null, 2) : ""
}
