import { useSelector } from "@tanstack/react-store"
import { useAtomValue } from "jotai"
import { createContext, useContext, useMemo } from "react"
import { createDuplicateNameValidator } from "@/components/form/duplicate-name-validator"
import ProviderIcon from "@/components/provider-icon"
import { useTheme } from "@/components/providers/theme-provider"
import { Button } from "@/components/ui/base-ui/button"
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog"
import type { APIProviderConfig } from "@/types/config/provider"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { API_PROVIDER_ITEMS } from "@/utils/constants/providers"
import { i18n } from "@/utils/i18n"
import { APIKeyField } from "./provider-config-form/api-key-field"
import { AdvancedOptionsSection } from "./provider-config-form/components/advanced-options-section"
import { ConfigHeader as ProviderConfigHeader } from "./provider-config-form/config-header"
import { formOpts, useAppForm } from "./provider-config-form/form"
import { ProviderHeadersField } from "./provider-config-form/provider-headers-field"
import { ProviderOptionsField } from "./provider-config-form/provider-options-field"
import { ProviderURLField } from "./provider-config-form/provider-url-field"
import { TemperatureField } from "./provider-config-form/temperature-field"
import { TranslateModelSelector } from "./provider-config-form/translate-model-selector"

interface ProviderIdentity {
  id: string
  logo: string
  name: string
}

interface ProviderEditorContextValue {
  state: {
    identity: ProviderIdentity
  }
  actions: {
    duplicate?: () => Promise<void>
    delete?: () => Promise<void>
  }
}

const ProviderEditorContext = createContext<ProviderEditorContextValue | null>(null)

export function useProviderEditor() {
  const context = useContext(ProviderEditorContext)
  if (!context) {
    throw new Error("ProviderEditor components must be rendered inside a ProviderEditor Provider")
  }
  return context
}

function useRequiredProviderCommand(command: "duplicate" | "delete") {
  const action = useProviderEditor().actions[command]
  if (!action) {
    throw new Error(`ProviderEditor.${command} is unavailable in this composition`)
  }
  return action
}

function useProviderEditorValue({
  identity,
  duplicate,
  delete: deleteProvider,
}: {
  identity: ProviderIdentity
  duplicate?: () => Promise<void>
  delete?: () => Promise<void>
}): ProviderEditorContextValue {
  // Memoized so a re-render of the host (which rebuilds `identity` inline)
  // doesn't hand every consumer a fresh context value.
  return useMemo(() => {
    return {
      state: {
        identity,
      },
      actions: {
        ...(duplicate ? { duplicate } : {}),
        ...(deleteProvider ? { delete: deleteProvider } : {}),
      },
    }
    // eslint-disable-next-line react/exhaustive-deps
  }, [identity, duplicate, deleteProvider])
}

export function useProviderForm(
  providerConfig: APIProviderConfig,
  save: (providerConfig: APIProviderConfig) => Promise<void>,
) {
  return useAppForm({
    ...formOpts,
    defaultValues: providerConfig,
    onSubmit: async ({ value }) => {
      await save(value)
    },
  })
}

type ProviderForm = ReturnType<typeof useProviderForm>

const ApiProviderFormContext = createContext<ProviderForm | null>(null)

function useApiProviderForm() {
  const form = useContext(ApiProviderFormContext)
  if (!form) {
    throw new Error("ProviderEditor form fields require a CustomProviderEditor Provider")
  }
  return form
}

function CustomProvider({
  providerConfig,
  form,
  duplicate,
  delete: deleteProvider,
  children,
}: {
  providerConfig: APIProviderConfig
  form: ProviderForm
  duplicate: () => Promise<void>
  delete: () => Promise<void>
  children: React.ReactNode
}) {
  const { theme } = useTheme()
  const provider = API_PROVIDER_ITEMS[providerConfig.provider]
  const value = useProviderEditorValue({
    identity: {
      id: providerConfig.id,
      logo: provider.logo(theme),
      name: providerConfig.name,
    },
    duplicate,
    delete: deleteProvider,
  })

  return (
    <ProviderEditorContext value={value}>
      <ApiProviderFormContext value={form}>{children}</ApiProviderFormContext>
    </ProviderEditorContext>
  )
}

function Form({ children }: { children: React.ReactNode }) {
  const form = useApiProviderForm()
  return <form.AppForm>{children}</form.AppForm>
}

function Identity() {
  const { identity } = useProviderEditor().state
  return (
    <ProviderIcon
      logo={identity.logo}
      name={identity.name}
      size="base"
      textClassName="font-medium"
    />
  )
}

function Attribution({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-6 text-muted-foreground">{children}</p>
}

function ConfigHeader() {
  const form = useApiProviderForm()
  const providerType = useSelector(form.store, (state) => state.values.provider)
  return <ProviderConfigHeader providerType={providerType} />
}

function NameField() {
  const form = useApiProviderForm()
  const providerId = useProviderEditor().state.identity.id
  const providersConfig = useAtomValue(configFieldsAtomMap.providersConfig)

  return (
    <form.AppField
      name="name"
      validators={{
        onChange: createDuplicateNameValidator({
          entities: providersConfig,
          currentEntityId: providerId,
          message: (name) => i18n.t("options.apiProviders.form.duplicateProviderName", [name]),
        }),
      }}
    >
      {(field) => (
        <field.InputFieldAutoSave
          formForSubmit={form}
          label={i18n.t("options.apiProviders.form.fields.name")}
        />
      )}
    </form.AppField>
  )
}

function DescriptionField() {
  const form = useApiProviderForm()
  return (
    <form.AppField name="description">
      {(field) => (
        <field.InputFieldAutoSave
          formForSubmit={form}
          label={i18n.t("options.apiProviders.form.fields.description")}
        />
      )}
    </form.AppField>
  )
}

function ConnectionFields() {
  const form = useApiProviderForm()
  return (
    <>
      <ProviderURLField form={form} />
      <APIKeyField form={form} />
    </>
  )
}

function TranslationModelFields() {
  const form = useApiProviderForm()
  return <TranslateModelSelector form={form} />
}

function AdvancedFields() {
  const form = useApiProviderForm()
  return (
    <AdvancedOptionsSection>
      <TemperatureField form={form} />
      <ProviderOptionsField form={form} />
      <ProviderHeadersField form={form} />
    </AdvancedOptionsSection>
  )
}

function DuplicateButton() {
  const duplicate = useRequiredProviderCommand("duplicate")
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void duplicate()}>
      {i18n.t("options.apiProviders.form.duplicate")}
    </Button>
  )
}

function DeleteButton() {
  const deleteProvider = useRequiredProviderCommand("delete")

  return (
    <ConfirmActionDialog
      trigger={i18n.t("options.apiProviders.form.delete")}
      triggerButtonProps={{ variant: "destructive", size: "sm" }}
      title={i18n.t("options.apiProviders.form.deleteDialog.title")}
      description={i18n.t("options.apiProviders.form.deleteDialog.description")}
      cancelLabel={i18n.t("options.apiProviders.form.deleteDialog.cancel")}
      confirmLabel={i18n.t("options.apiProviders.form.deleteDialog.confirm")}
      onConfirm={() => void deleteProvider()}
    />
  )
}

export const ProviderEditor = {
  Form,
  Identity,
  Attribution,
  ConfigHeader,
  NameField,
  DescriptionField,
  ConnectionFields,
  TranslationModelFields,
  AdvancedFields,
  DuplicateButton,
  DeleteButton,
}

export const CustomProviderEditor = {
  Provider: CustomProvider,
}
