import { useSelector } from "@tanstack/react-store"
import type { APIProviderConfig } from "@/types/config/provider"
import { PROVIDER_URL_PLACEHOLDERS } from "@/utils/constants/providers"
import { i18n } from "@/utils/i18n"
import { withForm } from "./form"

export const ProviderURLField = withForm({
  ...{ defaultValues: {} as APIProviderConfig },
  render: function Render({ form }) {
    const providerConfig = useSelector(form.store, (state) => state.values)
    const providerType = providerConfig.provider

    if (providerType === "deepl") {
      return null
    }

    return (
      <form.AppField name="baseURL">
        {(field) => (
          <field.InputFieldAutoSave
            formForSubmit={form}
            label={i18n.t("options.apiProviders.form.fields.baseURL")}
            placeholder={PROVIDER_URL_PLACEHOLDERS[providerType]}
            labelExtra={undefined}
          />
        )}
      </form.AppField>
    )
  },
})
