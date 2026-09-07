import { useAtom } from "jotai"
import { Input } from "@/components/ui/base-ui/input"
import { toastManager } from "@/components/ui/base-ui/toast"
import { videoSubtitlesSchema } from "@/types/config/subtitles"
import type { BatchQueueConfig } from "@/types/config/translate"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import {
  MAX_TRANSLATE_LOOK_AHEAD_SECONDS,
  MIN_TRANSLATE_LOOK_AHEAD_SECONDS,
} from "@/utils/constants/subtitles"
import {
  MIN_BATCH_CHARACTERS,
  MIN_BATCH_DELAY_SECONDS,
  MIN_BATCH_ITEMS,
} from "@/utils/constants/translate"
import { i18n } from "@/utils/i18n"
import { BatchSavingsNote } from "../../../components/batch-savings-note"
import { ConfigItem } from "../../../components/config-item"
import { BatchQueueNumberInput } from "../../../components/queue-number-inputs"

type KeyOfBatchQueueConfig = keyof BatchQueueConfig

const propertyMinValue = {
  maxCharactersPerBatch: MIN_BATCH_CHARACTERS,
  maxItemsPerBatch: MIN_BATCH_ITEMS,
  minItemsPerBatch: MIN_BATCH_ITEMS,
  batchDelay: MIN_BATCH_DELAY_SECONDS,
}

/** How many subtitle lines ride along in one request — the two limits that cap a batch. */
export function BatchTranslationItems() {
  return (
    <>
      <ConfigItem
        id="subtitles-request-batch"
        title={
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {i18n.t("options.videoSubtitles.subtitlesQueue.batchQueueConfig.title")}
            <BatchSavingsNote />
          </span>
        }
        description={i18n.t(
          "options.videoSubtitles.subtitlesQueue.batchQueueConfig.maxCharactersPerBatch.description",
        )}
      >
        <BatchNumberInput property="maxCharactersPerBatch" />
      </ConfigItem>
      <ConfigItem
        description={i18n.t(
          "options.videoSubtitles.subtitlesQueue.batchQueueConfig.maxItemsPerBatch.description",
        )}
      >
        <BatchNumberInput property="maxItemsPerBatch" />
      </ConfigItem>
      <ConfigItem
        description={i18n.t(
          "options.videoSubtitles.subtitlesQueue.batchQueueConfig.minItemsPerBatch.description",
        )}
      >
        <BatchNumberInput property="minItemsPerBatch" />
      </ConfigItem>
      <ConfigItem
        description={i18n.t(
          "options.videoSubtitles.subtitlesQueue.batchQueueConfig.batchDelay.description",
        )}
      >
        <BatchNumberInput property="batchDelay" />
      </ConfigItem>
      <LookAheadInput />
    </>
  )
}

function BatchNumberInput({ property }: { property: KeyOfBatchQueueConfig }) {
  const [videoSubtitlesConfig, setVideoSubtitlesConfig] = useAtom(
    configFieldsAtomMap.videoSubtitles,
  )

  return (
    <BatchQueueNumberInput
      property={property}
      value={videoSubtitlesConfig.batchQueueConfig[property]}
      min={propertyMinValue[property]}
      onCommit={(newConfigValue) => {
        // Persisting is enough: the background watches the stored config
        // and applies queue changes itself (no droppable message).
        void setVideoSubtitlesConfig({
          batchQueueConfig: {
            ...videoSubtitlesConfig.batchQueueConfig,
            [property]: newConfigValue,
          },
        })
      }}
    />
  )
}

/** How far ahead of the playback position subtitles are translated. Replaces the
 * per-queue batching window on this page; the queue's own delay stays at its default. */
function LookAheadInput() {
  const [videoSubtitlesConfig, setVideoSubtitlesConfig] = useAtom(
    configFieldsAtomMap.videoSubtitles,
  )
  const value = videoSubtitlesConfig.translateLookAheadSeconds

  const commit = (newConfigValue: number) => {
    void setVideoSubtitlesConfig({ translateLookAheadSeconds: newConfigValue })
  }

  return (
    <ConfigItem
      description={i18n.t("options.videoSubtitles.subtitlesQueue.translateLookAhead.description")}
    >
      <Input
        className="w-24 shrink-0"
        type="number"
        min={MIN_TRANSLATE_LOOK_AHEAD_SECONDS}
        max={MAX_TRANSLATE_LOOK_AHEAD_SECONDS}
        step="any"
        value={value}
        onChange={(e) => {
          const newConfigValue = Number(e.target.value)
          const configParseResult = videoSubtitlesSchema
            .pick({ translateLookAheadSeconds: true })
            .safeParse({ translateLookAheadSeconds: newConfigValue })
          if (configParseResult.success) {
            commit(newConfigValue)
          } else {
            toastManager.add({
              type: "error",
              title: configParseResult.error?.issues[0]?.message,
            })
          }
        }}
      />
    </ConfigItem>
  )
}
