type FieldError = string | { message?: string } | undefined

/**
 * TanStack field errors render as plain strings; object errors surface their
 * `message`.
 */
export function formatFieldErrors(errors: readonly FieldError[]): string {
  return errors.map((error) => (typeof error === "string" ? error : error?.message)).join(", ")
}

/**
 * The inline error line under a form field: nothing while the field is valid,
 * every current error joined when it is not.
 */
export function FieldErrorText({ errors }: { errors: readonly FieldError[] }) {
  if (errors.length === 0) {
    return null
  }
  return <span className="text-sm font-normal text-destructive">{formatFieldErrors(errors)}</span>
}
