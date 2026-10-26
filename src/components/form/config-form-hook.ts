import { createFormHook } from "@tanstack/react-form"
import { fieldContext, formContext } from "./form-context"
import { InputFieldAutoSave } from "./input-field-auto-save"
import { SelectFieldAutoSave } from "./select-field-auto-save"

/**
 * Single createFormHook instance for the config entity forms (API providers,
 * custom actions): they register the same auto-save field components, so one
 * hook binding serves every schema. Each form module keeps only its `formOpts`.
 */
export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    InputFieldAutoSave,
    SelectFieldAutoSave,
  },
  formComponents: {},
  fieldContext,
  formContext,
})
