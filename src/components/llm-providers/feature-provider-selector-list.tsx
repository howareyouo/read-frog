import { type ComponentProps, useMemo } from "react"
import ProviderMultiSelector from "@/components/llm-providers/provider-multi-selector"
import ProviderSelector from "@/components/llm-providers/provider-selector"
import { Field, FieldGroup, FieldTitle } from "@/components/ui/base-ui/field"
import type { FeatureKey } from "@/utils/constants/feature-providers"
import { FEATURE_KEYS, getFeatureLabelI18nKey } from "@/utils/constants/feature-providers"
import { i18n } from "@/utils/i18n"
import { cn } from "@/utils/styles/utils"
import { SetApiKeyWarning } from "./set-api-key-warning"
import { useCustomActionProviders, useFeatureProvider } from "./use-feature-providers"

type ProviderSelectorTriggerSize = ComponentProps<typeof ProviderSelector>["triggerSize"]

interface FeatureProviderSelectorListProps {
  className?: string
  providerSelectorClassName?: string
  providerSelectorTriggerSize?: ProviderSelectorTriggerSize
  includeCustomActions?: boolean
}

function FeatureProviderField({
  featureKey,
  providerSelectorClassName,
  providerSelectorTriggerSize,
}: {
  featureKey: FeatureKey
  providerSelectorClassName?: string
  providerSelectorTriggerSize?: ProviderSelectorTriggerSize
}) {
  const { providerOptions, providers, setProviders } = useFeatureProvider(featureKey)

  const selectedProviders = useMemo(
    () =>
      providers
        .map((id) => providerOptions.find((provider) => provider.id === id))
        .filter((provider) => provider !== undefined),
    [providers, providerOptions],
  )

  return (
    <Field>
      <FieldTitle className="flex flex-wrap items-center gap-2">
        {i18n.t(getFeatureLabelI18nKey(featureKey))}
        <SetApiKeyWarning providerConfigs={selectedProviders} />
      </FieldTitle>
      <ProviderMultiSelector
        providers={providerOptions}
        value={providers}
        onChange={setProviders}
        className={providerSelectorClassName}
        triggerSize={providerSelectorTriggerSize}
      />
    </Field>
  )
}

function CustomActionProviderFields({
  providerSelectorClassName,
  providerSelectorTriggerSize,
}: {
  providerSelectorClassName?: string
  providerSelectorTriggerSize?: ProviderSelectorTriggerSize
}) {
  const { actions, providerOptions, getProviderConfig, setActionProvider } =
    useCustomActionProviders()

  if (actions.length === 0) {
    return null
  }

  return (
    <>
      <p className="text-sm font-medium text-muted-foreground">
        {i18n.t("options.selectionToolbar.customActions.title")}
      </p>
      {actions.map((action) => (
        <Field key={action.id}>
          <FieldTitle className="flex flex-wrap items-center gap-2">
            {action.name}
            <SetApiKeyWarning providerConfig={getProviderConfig(action)} />
          </FieldTitle>
          <ProviderSelector
            providers={providerOptions}
            value={action.provider}
            onChange={(id) => setActionProvider(action.id, id)}
            className={providerSelectorClassName}
            triggerSize={providerSelectorTriggerSize}
            placeholder={i18n.t("options.selectionToolbar.customActions.form.selectProvider")}
          />
        </Field>
      ))}
    </>
  )
}

export function FeatureProviderSelectorList({
  className,
  providerSelectorClassName = "w-full",
  providerSelectorTriggerSize,
  includeCustomActions = true,
}: FeatureProviderSelectorListProps) {
  return (
    <FieldGroup className={cn("gap-4", className)}>
      {FEATURE_KEYS.map((featureKey) => (
        <FeatureProviderField
          key={featureKey}
          featureKey={featureKey}
          providerSelectorClassName={providerSelectorClassName}
          providerSelectorTriggerSize={providerSelectorTriggerSize}
        />
      ))}
      {includeCustomActions && (
        <CustomActionProviderFields
          providerSelectorClassName={providerSelectorClassName}
          providerSelectorTriggerSize={providerSelectorTriggerSize}
        />
      )}
    </FieldGroup>
  )
}
