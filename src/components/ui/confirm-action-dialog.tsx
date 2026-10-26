import type * as React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/base-ui/alert-dialog"
import { Button } from "@/components/ui/base-ui/button"

interface ConfirmActionDialogProps {
  /** Trigger label; omit for a fully controlled dialog (open/onOpenChange only). */
  trigger?: React.ReactNode
  /** Props for the trigger button (variant, size, disabled, ...). */
  triggerButtonProps?: Omit<React.ComponentProps<typeof Button>, "children">
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  cancelLabel: React.ReactNode
  confirmLabel: React.ReactNode
  confirmVariant?: React.ComponentProps<typeof Button>["variant"]
  onConfirm?: () => void
  confirmDisabled?: boolean
  footerClassName?: string
}

/**
 * The confirm/cancel alert dialog used across the options pages (delete
 * provider/action, remove API key, reset config, clear cache, delete backup...).
 * Renders the standard header + cancel/confirm footer; the confirm action
 * defaults to the destructive variant.
 */
export function ConfirmActionDialog({
  trigger,
  triggerButtonProps,
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  confirmVariant = "destructive",
  onConfirm,
  confirmDisabled,
  footerClassName,
}: ConfirmActionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && (
        <AlertDialogTrigger render={<Button type="button" {...triggerButtonProps} />}>
          {trigger}
        </AlertDialogTrigger>
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description !== undefined && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className={footerClassName}>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
