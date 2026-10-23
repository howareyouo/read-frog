import { useAtom } from "jotai"
import { Icon } from "@/components/icons/icon"
import { Button } from "@/components/ui/base-ui/button"
import { Card } from "@/components/ui/base-ui/card"
import { Label } from "@/components/ui/base-ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/base-ui/tooltip"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SCALE,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_SUBTITLE_COLOR,
} from "@/utils/constants/subtitles"
import type { I18nKey } from "@/utils/i18n"
import { i18n } from "@/utils/i18n"
import { deepmerge } from "@/utils/merge"
import { SubtitlesTextStyleForm } from "./subtitles-text-style-form"

/**
 * One style card for either subtitle track — the main track and the translated
 * track differ only in icon, heading, and which `style` field they reset, so both
 * render from this single component.
 */
const CARD_META = {
  main: {
    icon: "tabler:typography",
    labelKey: "options.videoSubtitles.style.mainSubtitle",
  },
  translation: {
    icon: "tabler:language",
    labelKey: "options.videoSubtitles.style.translationSubtitle",
  },
} as const satisfies Record<"main" | "translation", { icon: string; labelKey: I18nKey }>

const RESET_DEFAULTS = {
  fontFamily: DEFAULT_FONT_FAMILY,
  fontScale: DEFAULT_FONT_SCALE,
  color: DEFAULT_SUBTITLE_COLOR,
  fontWeight: DEFAULT_FONT_WEIGHT,
}

export function SubtitlesStyleCard({ type }: { type: "main" | "translation" }) {
  const [videoSubtitlesConfig, setVideoSubtitlesConfig] = useAtom(
    configFieldsAtomMap.videoSubtitles,
  )

  const resetSubtitlesStyleConfig = () => {
    void setVideoSubtitlesConfig(
      deepmerge(
        videoSubtitlesConfig,
        type === "main"
          ? { style: { main: RESET_DEFAULTS } }
          : { style: { translation: RESET_DEFAULTS } },
      ),
    )
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon icon={CARD_META[type].icon} className="size-4" />
          <Label className="text-sm font-semibold">{i18n.t(CARD_META[type].labelKey)}</Label>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="-mr-2"
                onClick={resetSubtitlesStyleConfig}
              />
            }
          >
            <Icon icon="tabler:refresh" />
          </TooltipTrigger>
          <TooltipContent>{i18n.t("options.videoSubtitles.style.reset")}</TooltipContent>
        </Tooltip>
      </div>

      <SubtitlesTextStyleForm type={type} />
    </Card>
  )
}
