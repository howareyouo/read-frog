import { IconRefresh } from "@tabler/icons-react"
import { useSetAtom } from "jotai"
import { useContext, useState } from "react"
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog"
import { writeConfigAtom } from "@/utils/atoms/config"
import { buildFreshDefaultConfig } from "@/utils/constants/config"
import { i18n } from "@/utils/i18n"
import { ConfigItem } from "../../../../components/config-item"

export function ResetConfigItem() {
  const [open, setOpen] = useState(false)
  const setConfig = useSetAtom(writeConfigAtom)
  async function resetToDefaultConfig() {
    await setConfig(buildFreshDefaultConfig())
    setOpen(false)
  }

  return (
    <ConfigItem
      id="reset-config"
      title={i18n.t("options.preference.config.reset.title")}
      description={i18n.t("options.preference.config.reset.description")}
    >
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        trigger={
          <>
            <IconRefresh />
            {i18n.t("options.preference.config.reset.dialog.trigger")}
          </>
        }
        triggerButtonProps={{ variant: "destructive", size: "sm" }}
        title={i18n.t("options.preference.config.reset.dialog.title")}
        description={i18n.t("options.preference.config.reset.dialog.description")}
        cancelLabel={i18n.t("options.preference.config.reset.dialog.cancel")}
        confirmLabel={i18n.t("options.preference.config.reset.dialog.confirm")}
        onConfirm={resetToDefaultConfig}
      />
    </ConfigItem>
  )
}
