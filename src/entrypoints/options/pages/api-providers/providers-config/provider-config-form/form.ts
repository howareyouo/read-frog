import { formOptions } from "@tanstack/react-form"
import { apiProviderConfigItemSchema } from "@/types/config/provider"

export { useAppForm, withForm } from "@/components/form/config-form-hook"

export const formOpts = formOptions({
  validators: {
    onChange: apiProviderConfigItemSchema,
  },
})
