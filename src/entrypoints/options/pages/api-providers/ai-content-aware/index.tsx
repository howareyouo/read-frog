import { useAtom, useAtomValue } from "jotai"
import { useMemo } from "react"
import { Switch } from "@/components/ui/base-ui/switch"
import { configAtom, configFieldsAtomMap } from "@/utils/atoms/config"
import type { FeatureKey } from "@/utils/constants/feature-providers"
import {
  getFeatureLabelI18nKey,
  getPrimaryFeatureProviderId,
  resolveProviderConfigOrNull,
} from "@/utils/constants/feature-providers"
import { i18n } from "@/utils/i18n"
import {
  hasUsableLLMFeatureProvider,
  isPrimaryFeatureProviderLLM,
} from "@/utils/providers/feature-provider-resolver"
import { ConfigItem } from "../../../components/config-item"
import { ConfigSection } from "../../../components/config-section"

/** Only the features whose prompts change with the smart-context flag. */
const CONTEXT_AWARE_FEATURE_KEYS = [
  "pageTranslation",
  "videoSubtitles",
  "selectionTranslation",
  "inputTranslation",
] as const satisfies readonly FeatureKey[]

/**
 * Page and subtitle summaries are built once per page or video by the feature's *first* selected
 * provider (`resolvePageTranslationProvider`, `resolveSubtitlesProviderRef`), so an LLM further
 * down the rotation never writes one. Selection and input translation pick a provider per request
 * and build their context from that same provider, so any LLM in the rotation is enough there.
 */
const SUMMARY_COMES_FROM_FIRST: readonly FeatureKey[] = ["pageTranslation", "videoSubtitles"]

type FeatureStatus = "ok" | "notFirst" | "none"

interface FeatureLine {
  featureKey: FeatureKey
  status: FeatureStatus
  text: string
}

/**
 * Context reaches a prompt only on an LLM provider — a pure translate service (Google, Microsoft,
 * DeepL…) has no prompt to put it in — and rotation decides which provider a feature runs on, so
 * each feature reports on its own line. Mixed rotations are normal and fine: the requests that
 * land on a pure translator simply go without context.
 */
function useFeatureStatuses(): FeatureLine[] {
  const config = useAtomValue(configAtom)

  return useMemo(
    () =>
      CONTEXT_AWARE_FEATURE_KEYS.map((featureKey) => {
        const featureName = i18n.t(getFeatureLabelI18nKey(featureKey))
        if (!hasUsableLLMFeatureProvider(config, featureKey)) {
          return {
            featureKey,
            status: "none" as const,
            text: i18n.t("options.apiProviders.aiContentAware.llmProviderNotConfigured", [
              featureName,
            ]),
          }
        }

        // An LLM that is not first cannot write the summary, so say so rather than showing an
        // all-clear the translation will quietly contradict.
        if (
          SUMMARY_COMES_FROM_FIRST.includes(featureKey) &&
          !isPrimaryFeatureProviderLLM(config, featureKey)
        ) {
          // A provider row deleted out of providersConfig leaves its id behind; name that instead.
          const primary = resolveProviderConfigOrNull(config, featureKey)
          const primaryName = primary?.name ?? getPrimaryFeatureProviderId(config, featureKey)
          return {
            featureKey,
            status: "notFirst" as const,
            text: i18n.t("options.apiProviders.aiContentAware.llmProviderNotFirst", [
              featureName,
              primaryName,
            ]),
          }
        }

        return {
          featureKey,
          status: "ok" as const,
          text: i18n.t("options.apiProviders.aiContentAware.llmProviderConfigured", [featureName]),
        }
      }),
    [config],
  )
}

const STATUS_DOT_CLASS: Record<FeatureStatus, string> = {
  ok: "bg-green-500",
  notFirst: "bg-yellow-500",
  none: "bg-orange-400",
}

function FeatureStatusList() {
  const statuses = useFeatureStatuses()

  return (
    <span className="mt-2 flex flex-col gap-1">
      {statuses.map(({ featureKey, status, text }) => (
        <span key={featureKey} className="flex items-center gap-1.5">
          <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[status]}`} />
          <span className="text-xs">{text}</span>
        </span>
      ))}
    </span>
  )
}

export function AIContentAwareConfig() {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.pageTranslation)

  return (
    <ConfigSection
      id="ai-content-aware"
      title={i18n.t("options.apiProviders.aiContentAware.title")}
    >
      <ConfigItem
        title={i18n.t("options.apiProviders.aiContentAware.enable")}
        description={
          <>
            {i18n.t("options.apiProviders.aiContentAware.enableDescription")}
            <FeatureStatusList />
          </>
        }
      >
        <Switch
          checked={translateConfig.enableAIContentAware}
          onCheckedChange={(checked) => {
            void setTranslateConfig({ enableAIContentAware: checked })
          }}
        />
      </ConfigItem>
    </ConfigSection>
  )
}
