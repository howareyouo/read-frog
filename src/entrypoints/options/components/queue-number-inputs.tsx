import { useState } from "react"
import { Input } from "@/components/ui/base-ui/input"
import { toastManager } from "@/components/ui/base-ui/toast"
import type { BatchQueueConfig, RequestQueueConfig } from "@/types/config/translate"
import { batchQueueConfigSchema, requestQueueConfigSchema } from "@/types/config/translate"

/**
 * The two queue number inputs shared by the page-translation and video-subtitles
 * queue pages. Each owns its draft/validation/toast behavior; the caller owns the
 * config slice (atom wiring differs per page) and supplies the current value plus
 * a commit callback that only fires with schema-valid input.
 */

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
    <Input
      className="w-24 shrink-0"
      type="number"
      min={min}
      // batchDelay accepts decimals (seconds); "any" keeps 0.1 typable and
      // lets the spinner step below 1.
      step="any"
      value={value}
      onChange={(e) => {
        const newConfigValue = Number(e.target.value)
        const configParseResult = batchQueueConfigSchema
          .partial()
          .safeParse({ [property]: newConfigValue })
        if (configParseResult.success) {
          onCommit(newConfigValue)
        } else {
          toastManager.add({
            type: "error",
            title: configParseResult.error?.issues[0]!.message,
          })
        }
      }}
    />
  )
}
