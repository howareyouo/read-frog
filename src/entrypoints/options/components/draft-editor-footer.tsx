import type { ReactNode } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { cn } from "@/utils/styles/utils"

/**
 * The status line + save button shared by the explicit-save editors (custom
 * CSS, user site rules). The button enables only while the draft is settled,
 * valid, and unsaved; callers keep their own guard inside `onSave` so a
 * programmatic click can never persist an invalid draft either.
 */
export function DraftEditorFooter({
  message,
  isValidating,
  hasError,
  hasChanges,
  onSave,
  saveButtonLabel,
  savedButtonLabel,
}: {
  message: ReactNode
  isValidating: boolean
  hasError: boolean
  hasChanges: boolean
  onSave: () => void
  saveButtonLabel: string
  savedButtonLabel: string
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div
        className={cn(
          "text-sm text-green-500",
          isValidating && "text-muted-foreground",
          hasError && "text-destructive",
        )}
      >
        {message}
      </div>
      <Button onClick={onSave} disabled={isValidating || hasError || !hasChanges}>
        {hasChanges ? saveButtonLabel : savedButtonLabel}
      </Button>
    </div>
  )
}
