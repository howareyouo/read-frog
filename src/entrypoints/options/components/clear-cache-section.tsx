import { IconTrash } from "@tabler/icons-react"
import { useContext, useState } from "react"
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog"
import type { I18nKey } from "@/utils/i18n"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { ConfigItem } from "./config-item"
import { ConfigSection } from "./config-section"

/**
 * The "clear cache" section shared by the page-translation and video-subtitles
 * pages: same dialog, same clearing state — only the cache being cleared and the
 * wording differ. Keys are a literal table so each stays type-checked against the
 * generated `I18nKey` union.
 */
const CACHE_I18N_KEYS = {
  translation: {
    sectionTitle: "options.translation.cache.title",
    itemTitle: "options.translation.cache.clearCache.title",
    itemDescription: "options.translation.cache.clearCache.description",
    clearing: "options.translation.cache.clearCache.clearing",
    trigger: "options.translation.cache.clearCache.dialog.trigger",
    dialogTitle: "options.translation.cache.clearCache.dialog.title",
    dialogDescription: "options.translation.cache.clearCache.dialog.description",
    cancel: "options.translation.cache.clearCache.dialog.cancel",
    confirm: "options.translation.cache.clearCache.dialog.confirm",
  },
  videoSubtitles: {
    sectionTitle: "options.videoSubtitles.cache.title",
    itemTitle: "options.videoSubtitles.cache.clearCache.title",
    itemDescription: "options.videoSubtitles.cache.clearCache.description",
    clearing: "options.videoSubtitles.cache.clearCache.clearing",
    trigger: "options.videoSubtitles.cache.clearCache.dialog.trigger",
    dialogTitle: "options.videoSubtitles.cache.clearCache.dialog.title",
    dialogDescription: "options.videoSubtitles.cache.clearCache.dialog.description",
    cancel: "options.videoSubtitles.cache.clearCache.dialog.cancel",
    confirm: "options.videoSubtitles.cache.clearCache.dialog.confirm",
  },
} as const satisfies Record<string, Record<string, I18nKey>>

const SECTION_IDS = {
  translation: { section: "cache", item: "clear-cache" },
  videoSubtitles: { section: "subtitles-cache", item: "clear-ai-segmentation-cache" },
} as const

const CLEAR_MESSAGES = {
  translation: "clearAllTranslationRelatedCache",
  videoSubtitles: "clearAiSegmentationCache",
} as const

export function ClearCacheSection({ variant }: { variant: keyof typeof CACHE_I18N_KEYS }) {
  const [open, setOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const keys = CACHE_I18N_KEYS[variant]

  async function handleClearCache() {
    try {
      setIsClearing(true)
      await sendMessage(CLEAR_MESSAGES[variant])
    } catch (error) {
      console.error("Failed to clear cache:", error)
    } finally {
      setIsClearing(false)
      setOpen(false)
    }
  }

  return (
    <ConfigSection id={SECTION_IDS[variant].section} title={i18n.t(keys.sectionTitle)}>
      <ConfigItem
        id={SECTION_IDS[variant].item}
        title={i18n.t(keys.itemTitle)}
        description={i18n.t(keys.itemDescription)}
      >
        <ConfirmActionDialog
          open={open}
          onOpenChange={setOpen}
          trigger={
            <>
              <IconTrash className="size-4" />
              {isClearing ? i18n.t(keys.clearing) : i18n.t(keys.trigger)}
            </>
          }
          triggerButtonProps={{ variant: "destructive", size: "sm", disabled: isClearing }}
          title={i18n.t(keys.dialogTitle)}
          description={i18n.t(keys.dialogDescription)}
          cancelLabel={i18n.t(keys.cancel)}
          confirmLabel={isClearing ? i18n.t(keys.clearing) : i18n.t(keys.confirm)}
          confirmDisabled={isClearing}
          onConfirm={handleClearCache}
        />
      </ConfigItem>
    </ConfigSection>
  )
}
