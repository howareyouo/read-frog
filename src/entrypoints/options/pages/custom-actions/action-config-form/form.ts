import { formOptions } from "@tanstack/react-form"
import { selectionToolbarCustomActionSchema } from "@/types/config/selection-toolbar"

export { useAppForm, withForm } from "@/components/form/config-form-hook"

export const formOpts = formOptions({
  validators: {
    onChange: selectionToolbarCustomActionSchema,
  },
})
