import { useSelector } from "@tanstack/react-store"
import { Field, FieldError, FieldLabel } from "@/components/ui/base-ui/field"
import type { InsertCell } from "@/components/ui/insertable-textarea"
import { QuickInsertableTextarea } from "@/components/ui/insertable-textarea"
import { formatFieldErrors } from "./field-error-text"
import { useFieldContext } from "./form-context"
import { useDebouncedSubmit } from "./use-debounced-submit"

interface QuickInsertableTextareaFieldAutoSaveProps {
  /** When provided, value changes also trigger a (debounced) form submit. */
  formForSubmit?: { handleSubmit: () => void }
  label: React.ReactNode
  insertCells?: InsertCell[]
  className?: string
  placeholder?: string
  readOnly?: boolean
}

export function QuickInsertableTextareaFieldAutoSave({
  formForSubmit,
  label,
  insertCells,
  className,
  placeholder,
  readOnly,
}: QuickInsertableTextareaFieldAutoSaveProps) {
  const field = useFieldContext<string>()
  const errors = useSelector(field.store, (state) => state.meta.errors)
  const hasError = errors.length > 0

  const debouncedSubmit = useDebouncedSubmit(formForSubmit)

  return (
    <Field data-invalid={hasError}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <QuickInsertableTextarea
        id={field.name}
        value={field.state.value}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
          field.handleChange(event.target.value)
          debouncedSubmit()
        }}
        aria-invalid={hasError}
        className={className}
        placeholder={placeholder}
        insertCells={insertCells}
        readOnly={readOnly}
      />
      <FieldError>{formatFieldErrors(errors)}</FieldError>
    </Field>
  )
}
