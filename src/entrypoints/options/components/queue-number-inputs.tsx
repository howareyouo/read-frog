import { useState } from "react"
import type { z } from "zod"
import { Input } from "@/components/ui/base-ui/input"
import { toastManager } from "@/components/ui/base-ui/toast"
import type { BatchQueueConfig, RequestQueueConfig } from "@/types/config/translate"
import { batchQueueConfigSchema, requestQueueConfigSchema } from "@/types/config/translate"

/**
 * Number inputs shared by the page-translation and video-subtitles queue pages.
 * Each owns its draft/validation/toast behavior; the caller owns the config slice
 * (atom wiring differs per page) and supplies the current value plus a commit
 * callback that only fires with schema-valid input.
 */

/** Controlled number input that validates every change against one property of a
 * config schema: valid input commits, invalid input toasts the schema message. */
export function SchemaNumberInput({
  schema,
  property,
  value,
  min,
  max,
  step = "any",
  className = "w-24 shrink-0",
  onCommit,
}: {
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>
  property: string
  value: number
  min?: number
  max?: number
  step?: number | "any"
  className?: string
  onCommit: (value: number) => void
}) {
  return (
    <Input
      className={className}
      type="number"
      min={min}
      max={max}
      // step "any" keeps decimal fields (batchDelay seconds, preload threshold)
      // typable and lets the spinner step below 1.
      step={step}
      value={value}
      onChange={(e) => {
        const newConfigValue = Number(e.target.value)
        const configParseResult = schema.partial().safeParse({ [property]: newConfigValue })
        if (configParseResult.success) {
          onCommit(newConfigValue)
        } else {
          toastManager.add({
            type: "error",
            title: configParseResult.error?.issues[0]?.message,
          })
        }
      }}
    />
  )
}

/** Burst allowance + steady refill pace. Keeps a local draft that resets when the
 * config value changes externally, commits valid changes as they type, and
 * restores the config value on blur if the draft is empty or invalid. */
export function RequestRateNumberInput({
  property,
  value,
  min,
  onCommit,
}: {
  property: keyof RequestQueueConfig
  value: number
  min: number
  onCommit: (value: number) => void
}) {
  const [inputValue, setInputValue] = useState(String(value))
  const [prevConfigValue, setPrevConfigValue] = useState(value)

  // Reset the draft input when the config value changes externally
  if (prevConfigValue !== value) {
    setPrevConfigValue(value)
    setInputValue(String(value))
  }

  return (
    <Input
      className="w-24 shrink-0"
      type="number"
      min={min}
      step="any"
      value={inputValue}
      onChange={(e) => {
        const rawValue = e.target.value
        setInputValue(rawValue)
        const newConfigValue = Number(rawValue)
        const configParseResult = requestQueueConfigSchema
          .partial()
          .safeParse({ [property]: newConfigValue })
        if (rawValue !== "" && configParseResult.success) {
          onCommit(newConfigValue)
        }
      }}
      onBlur={() => {
        const newConfigValue = Number(inputValue)
        const configParseResult = requestQueueConfigSchema
          .partial()
          .safeParse({ [property]: newConfigValue })
        if (inputValue === "" || !configParseResult.success) {
          toastManager.add({
            type: "error",
            title: configParseResult.error!.issues[0]!.message,
          })
          setInputValue(String(value))
        }
      }}
    />
  )
}

/** The two batch caps (characters and items per request). Commits every valid
 * change immediately and toasts on invalid ones. */
export function BatchQueueNumberInput({
  property,
  value,
  min,
  onCommit,
}: {
  property: keyof BatchQueueConfig
  value: number
  min: number
  onCommit: (value: number) => void
}) {
  return (
    <SchemaNumberInput
      schema={batchQueueConfigSchema}
      property={property}
      value={value}
      min={min}
      onCommit={onCommit}
    />
  )
}
