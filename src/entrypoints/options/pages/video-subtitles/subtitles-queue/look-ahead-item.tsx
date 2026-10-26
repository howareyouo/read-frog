import { useAtom } from "jotai"
import { videoSubtitlesSchema } from "@/types/config/subtitles"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import {
  MAX_TRANSLATE_LOOK_AHEAD_SECONDS,
  MIN_TRANSLATE_LOOK_AHEAD_SECONDS,
} from "@/utils/constants/subtitles"
import { i18n } from "@/utils/i18n"
import { ConfigItem } from "../../../components/config-item"
import { SchemaNumberInput } from "../../../components/queue-number-inputs"

/** How far ahead of the playback position subtitles are translated. Replaces the
 * per-queue batching window on this page; the queue's own delay stays at its default. */
export function LookAheadItem() {
  const [videoSubtitlesConfig, setVideoSubtitlesConfig] = useAtom(
    configFieldsAtomMap.videoSubtitles,
  )
  const value = videoSubtitlesConfig.translateLookAheadSeconds

  return (
    <ConfigItem
      description={i18n.t("options.videoSubtitles.subtitlesQueue.translateLookAhead.description")}
    >
      <SchemaNumberInput
        schema={videoSubtitlesSchema}
        property="translateLookAheadSeconds"
        value={value}
        min={MIN_TRANSLATE_LOOK_AHEAD_SECONDS}
        max={MAX_TRANSLATE_LOOK_AHEAD_SECONDS}
        onCommit={(newConfigValue) => {
          void setVideoSubtitlesConfig({ translateLookAheadSeconds: newConfigValue })
        }}
      />
    </ConfigItem>
  )
}
