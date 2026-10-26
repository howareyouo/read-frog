import { useSelector } from "@tanstack/react-store"
import type * as React from "react"
import { useCallback } from "react"
import { Field, FieldError, FieldTitle } from "@/components/ui/base-ui/field"
import { Select } from "@/components/ui/base-ui/select"
import { formatFieldErrors } from "./field-error-text"
import { useFieldContext } from "./form-context"
import { useDebouncedSubmit } from "./use-debounced-submit"

type SelectFieldAutoSaveProps = React.ComponentProps<typeof Select> & {
  /** When provided, value changes also trigger a (debounced) form submit. */
  formForSubmit?: { handleSubmit: () => void }
  label: React.ReactNode
  labelExtra?: React.ReactNode
}

export function SelectFieldAutoSave({
  formForSubmit,
  label,
  labelExtra,
  ...props
}: SelectFieldAutoSaveProps) {
  const field = useFieldContext<string | undefined>()
  const errors = useSelector(field.store, (state) => state.meta.errors)
  const hasError = errors.length > 0

  const debouncedSubmit = useDebouncedSubmit(formForSubmit)

  const handleValueChange = useCallback(
    (value: unknown) => {
      if (typeof value !== "string") return
      field.handleChange(value)
      debouncedSubmit()
    },
    [field, debouncedSubmit],
  )

  return (
    <Field data-invalid={hasError}>
      <div className="flex w-full items-end justify-between">
        <FieldTitle>{label}</FieldTitle>
        {labelExtra}
      </div>
      <Select value={field.state.value} onValueChange={handleValueChange} {...props}>
        {props.children}
      </Select>
      <FieldError>{formatFieldErrors(errors)}</FieldError>
    </Field>
  )
}
