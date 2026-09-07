import type { z } from "zod"
import type { LLMProviderTypes } from "./constants"

interface ProviderSettingBaseUiMeta {
  labelKey: string
  placeholder?: string
}

interface ProviderSettingTextUiMeta extends ProviderSettingBaseUiMeta {
  type: "text"
}

interface ProviderSettingSelectUiMeta extends ProviderSettingBaseUiMeta {
  type: "select"
  defaultValue?: string
  options: Array<{
    value: string
    labelKey: string
  }>
}

export type ProviderSettingUiMeta = ProviderSettingTextUiMeta | ProviderSettingSelectUiMeta

declare module "zod" {
  interface GlobalMeta {
    providerSettingUi?: ProviderSettingUiMeta
  }
}

export type ProviderSpecificSettingField = ProviderSettingUiMeta & {
  key: string
}

export type ProviderSpecificSettingsSchema = z.ZodObject<z.ZodRawShape>

export const PROVIDER_SPECIFIC_SETTINGS_SCHEMAS: Partial<
  Record<LLMProviderTypes, ProviderSpecificSettingsSchema>
> = {}

export function getProviderSpecificSettingFields(
  schema: ProviderSpecificSettingsSchema,
): ProviderSpecificSettingField[] {
  return Object.entries(schema.shape).map(([key, fieldSchema]) => {
    const ui = (fieldSchema as z.ZodType).meta()?.providerSettingUi

    if (!ui) {
      throw new Error(`providerSpecificSettings.${key} is missing providerSettingUi metadata`)
    }

    if (ui.type !== "text" && ui.type !== "select") {
      const unsupportedTypeValue = (ui as { type: unknown }).type
      const unsupportedType =
        typeof unsupportedTypeValue === "string"
          ? unsupportedTypeValue
          : JSON.stringify(unsupportedTypeValue)
      throw new Error(`Unsupported providerSpecificSettings.${key} field type: ${unsupportedType}`)
    }

    return {
      key,
      ...ui,
    }
  })
}
