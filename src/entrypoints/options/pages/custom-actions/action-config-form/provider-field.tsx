import { useAtomValue } from "jotai"
import { useMemo } from "react"
import { FieldErrorText } from "@/components/form/field-error-text"
import ProviderSelector from "@/components/llm-providers/provider-selector"
import { useSelectableProviders } from "@/components/llm-providers/use-feature-providers"
import { Field, FieldTitle } from "@/components/ui/base-ui/field"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { getProviderIdsForCapability } from "@/utils/providers/provider-registry"
import { withForm } from "./form"

export const ProviderField = withForm({
  ...{ defaultValues: {} as SelectionToolbarCustomAction },
  render: function Render({ form }) {
    const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)

    const customActionProviders = useSelectableProviders("customAction")
    const customActionProviderIds = useMemo(
      () =>
        getProviderIdsForCapability("customAction", providersConfig, {
          requireEnable: true,
        }),
      [providersConfig],
    )

    return (
      <form.AppField
        name="provider"
        validators={{
          onChange: ({ value }) => {
            if (!customActionProviderIds.includes(value)) {
              return i18n.t("options.selectionToolbar.customActions.errors.providerRequired")
            }
            return undefined
          },
        }}
      >
        {(field) => (
          <Field>
            <FieldTitle>
              {i18n.t("options.selectionToolbar.customActions.form.provider")}
            </FieldTitle>
            <ProviderSelector
              providers={customActionProviders}
              value={field.state.value}
              onChange={(id) => {
                field.handleChange(id)
                void form.handleSubmit()
              }}
              placeholder={i18n.t("options.selectionToolbar.customActions.form.selectProvider")}
            />
            <FieldErrorText errors={field.state.meta.errors} />
          </Field>
        )}
      </form.AppField>
    )
  },
})
