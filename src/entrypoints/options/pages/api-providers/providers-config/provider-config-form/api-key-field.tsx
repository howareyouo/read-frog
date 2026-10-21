import { IconPlus, IconX } from "@tabler/icons-react"
import { useSelector } from "@tanstack/react-store"
import { useAtom } from "jotai"
import { Fragment, useEffect, useState } from "react"
import { useDebouncedSubmit } from "@/components/form/use-debounced-submit"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/base-ui/alert-dialog"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import type { APIProviderConfig } from "@/types/config/provider"
import { isLLMProviderConfig } from "@/types/config/provider"
import { i18n } from "@/utils/i18n"
import { cn } from "@/utils/styles/utils"
import { highlightedProviderFieldAtom, PROVIDER_FIELD_HIGHLIGHT_DURATION_MS } from "../atoms"
import { ConnectionTestButton } from "./components/connection-button"
import { GetAPIKeyButton } from "./components/get-api-key-button"
import { withForm } from "./form"

/**
 * All key rows (primary + extras) share ONE grid so the connect-button column
 * is sized once for every row: a row in the wider 配置中 state narrows all
 * inputs equally instead of only its own, keeping the inputs the same width.
 */
const KEY_ROWS_GRID_CLASS =
  "grid grid-cols-[minmax(0,1fr)_auto_1.5rem] items-center gap-x-1.5 gap-y-2"

/** Sentinel for the primary key row in the remove-key dialog state. */
const PRIMARY_KEY = -1

function APIKeyInput({
  value,
  onChange,
  onBlur,
  isHighlighted,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  isHighlighted?: boolean
  ariaLabel?: string
}) {
  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      aria-label={ariaLabel}
      autoComplete="off"
      spellCheck={false}
      className={cn("min-w-0", isHighlighted && "animate-ring-flash")}
    />
  )
}

export const APIKeyField = withForm({
  ...{ defaultValues: {} as APIProviderConfig },
  render: function Render({ form }) {
    const providerConfig = useSelector(form.store, (state) => state.values)
    const [highlightedField, setHighlightedField] = useAtom(highlightedProviderFieldAtom)
    const isHighlighted = highlightedField === "apiKey"
    // Credential rotation (LLM providers): extra keys are persisted as-is —
    // blank rows are skipped by the rotation when it collects the key list.
    const debouncedSubmit = useDebouncedSubmit(form)
    const [keyToRemove, setKeyToRemove] = useState<number | null>(null)
    const apiKeys = isLLMProviderConfig(providerConfig) ? (providerConfig.apiKeys ?? []) : []
    // The last remaining key cannot be deleted: deleting the primary key
    // promotes the first extra key into its place, so the remove buttons are
    // hidden entirely once only the primary key is left.
    const canRemoveKey = 1 + apiKeys.length > 1

    // Clears itself so switching providers afterwards does not flash their key field too.
    useEffect(() => {
      if (!isHighlighted) return undefined

      const timeout = setTimeout(
        () => setHighlightedField(null),
        PROVIDER_FIELD_HIGHLIGHT_DURATION_MS,
      )
      return () => clearTimeout(timeout)
    }, [isHighlighted, setHighlightedField])

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm leading-none font-medium">API Key</span>
          <GetAPIKeyButton providerType={providerConfig.provider} />
        </div>
        <div className={KEY_ROWS_GRID_CLASS}>
          <form.AppField name="apiKey">
            {(field) => (
              <>
                <APIKeyInput
                  value={field.state.value ?? ""}
                  onChange={(value) => {
                    field.handleChange(value)
                    debouncedSubmit()
                  }}
                  onBlur={field.handleBlur}
                  isHighlighted={isHighlighted}
                />
                <ConnectionTestButton
                  providerConfig={{ ...providerConfig, apiKey: field.state.value }}
                />
                {isLLMProviderConfig(providerConfig) && canRemoveKey && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-xs"
                    aria-label={i18n.t("options.apiProviders.apiKey.removeKey")}
                    onClick={() => setKeyToRemove(PRIMARY_KEY)}
                  >
                    <IconX className="size-3.5" />
                  </Button>
                )}
              </>
            )}
          </form.AppField>
          {isLLMProviderConfig(providerConfig) && (
            <form.Field name="apiKeys">
              {(apiKeysField) => {
                const apiKeys = apiKeysField.state.value ?? []

                const setKey = (index: number, value: string) => {
                  const next = [...apiKeys]
                  next[index] = value
                  apiKeysField.handleChange(next)
                  debouncedSubmit()
                }

                // Removing the primary key promotes the first extra key into it.
                const confirmRemoveKey = () => {
                  if (keyToRemove === PRIMARY_KEY) {
                    form.setFieldValue("apiKey", apiKeys[0] ?? "")
                    apiKeysField.handleChange(apiKeys.slice(1))
                  } else if (keyToRemove !== null) {
                    apiKeysField.handleChange(apiKeys.filter((_, i) => i !== keyToRemove))
                  }
                  setKeyToRemove(null)
                  debouncedSubmit()
                }

                return (
                  <>
                    {apiKeys.map((apiKey, index) => (
                      <Fragment key={index}>
                        <APIKeyInput
                          value={apiKey}
                          onChange={(value) => setKey(index, value)}
                          ariaLabel={i18n.t("options.apiProviders.apiKey.additionalKeys")}
                          isHighlighted={isHighlighted}
                        />
                        <ConnectionTestButton providerConfig={{ ...providerConfig, apiKey }} />
                        {canRemoveKey && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon-xs"
                            aria-label={i18n.t("options.apiProviders.apiKey.removeKey")}
                            onClick={() => setKeyToRemove(index)}
                          >
                            <IconX className="size-3.5" />
                          </Button>
                        )}
                      </Fragment>
                    ))}
                    <AlertDialog
                      open={keyToRemove !== null}
                      onOpenChange={(open) => {
                        if (!open) setKeyToRemove(null)
                      }}
                    >
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {i18n.t("options.apiProviders.apiKey.removeKeyDialog.title")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {i18n.t("options.apiProviders.apiKey.removeKeyDialog.description")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>
                            {i18n.t("options.apiProviders.apiKey.removeKeyDialog.cancel")}
                          </AlertDialogCancel>
                          <AlertDialogAction variant="destructive" onClick={confirmRemoveKey}>
                            {i18n.t("options.apiProviders.apiKey.removeKeyDialog.confirm")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <div className="col-span-3 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className="w-fit"
                        onClick={() => {
                          apiKeysField.handleChange([...apiKeys, ""])
                          debouncedSubmit()
                        }}
                      >
                        <IconPlus className="size-3.5" />
                        {i18n.t("options.apiProviders.apiKey.addKey")}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {i18n.t("options.apiProviders.apiKey.additionalKeysHint")}
                      </span>
                    </div>
                  </>
                )
              }}
            </form.Field>
          )}
        </div>
      </div>
    )
  },
})
