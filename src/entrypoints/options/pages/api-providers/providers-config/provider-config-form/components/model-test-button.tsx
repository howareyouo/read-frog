import { useMutation } from "@tanstack/react-query"
import { useMemo } from "react"
import { Icon } from "@/components/icons/icon"
import LoadingDots from "@/components/loading-dots"
import { Button } from "@/components/ui/base-ui/button"
import type { LLMProviderConfig } from "@/types/config/provider"
import { getObjectWithoutAPIKeys } from "@/utils/config/api"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"

/**
 * Connectivity test for ONE model of a rotation list. The provider config is
 * sent as-is with the model pinned to the row's id — the direct translate
 * handler runs credentials pinned, so this tests exactly the model on the
 * row, with the provider's primary key.
 *
 * `externalState` lets a batch test drive this row's icon from outside: while
 * set it overrides the button's own mutation feedback (loading → result), so
 * "test and select" lights every row up as it goes.
 */
export function ModelTestButton({
  providerConfig,
  modelId,
  externalState,
}: {
  providerConfig: LLMProviderConfig
  modelId: string
  externalState?: "pending" | "success" | "error"
}) {
  const testConfig = useMemo(
    () =>
      // The union's per-provider model literals clash under a spread; only the
      // model slot changes, so the cast is safe.
      ({
        ...providerConfig,
        model: { ...providerConfig.model, model: modelId },
      }) as unknown as LLMProviderConfig,
    [providerConfig, modelId],
  )

  const mutation = useMutation({
    // for safety, we should not include apiKey in the mutationKey
    mutationKey: ["modelConnection", getObjectWithoutAPIKeys(testConfig)],
    mutationFn: async () => {
      return await sendMessage("directTranslate", {
        text: "Hi",
        langConfig: DEFAULT_CONFIG.language,
        providerConfig: testConfig,
      })
    },
  })

  // Result icons persist: a check / cross stays on the row until the next test
  // of that model, so the user can scan results at leisure.
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      title={i18n.t("options.apiProviders.testConnection.testModel")}
      aria-label={i18n.t("options.apiProviders.testConnection.testModel")}
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending || externalState === "pending"}
    >
      {externalState === "pending" || mutation.isPending ? (
        <LoadingDots className="scale-75" />
      ) : externalState === "success" || mutation.isSuccess ? (
        <Icon icon="tabler:check" className="size-3.5 text-green-600 dark:text-green-400" />
      ) : externalState === "error" || mutation.isError ? (
        <Icon icon="tabler:x" className="size-3.5 text-red-500" />
      ) : (
        <Icon icon="tabler:plug-connected" className="size-3.5" />
      )}
    </Button>
  )
}
