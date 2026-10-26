import { useAtomValue } from "jotai"
import { createDuplicateNameValidator } from "@/components/form/duplicate-name-validator"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { selectedCustomActionIdAtom } from "../atoms"
import { withForm } from "./form"

export const NameField = withForm({
  ...{ defaultValues: {} as SelectionToolbarCustomAction },
  props: {
    readOnly: false as boolean,
    labelExtra: undefined as React.ReactNode,
  },
  render: function Render({ form, readOnly, labelExtra }) {
    const selectionToolbarConfig = useAtomValue(configFieldsAtomMap.selectionToolbar)
    const selectedActionId = useAtomValue(selectedCustomActionIdAtom)
    const customActions = selectionToolbarConfig.customActions ?? []

    const duplicateNameValidator = createDuplicateNameValidator({
      entities: customActions,
      currentEntityId: selectedActionId,
      message: (name) =>
        i18n.t("options.selectionToolbar.customActions.errors.duplicateName", [name]),
    })

    return (
      <form.AppField
        name="name"
        validators={{
          onChange: ({ value }) => {
            if (!value.trim()) {
              return i18n.t("options.selectionToolbar.customActions.errors.nameRequired")
            }
            return duplicateNameValidator({ value })
          },
        }}
      >
        {(field) => (
          <field.InputFieldAutoSave
            formForSubmit={form}
            label={i18n.t("options.selectionToolbar.customActions.form.name")}
            labelExtra={labelExtra}
            readOnly={readOnly}
          />
        )}
      </form.AppField>
    )
  },
})
