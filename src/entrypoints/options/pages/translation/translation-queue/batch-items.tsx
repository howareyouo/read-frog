import { useAtom } from "jotai"
import type { BatchQueueConfig } from "@/types/config/translate"
import { configFieldsAtomMap } from "@/utils/atoms/config"
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

/** How much text rides along in one request — the two limits that cap a batch. */
export function BatchTranslationItems() {
  return (
    <>
      <ConfigItem
        id="request-batch"
        title={
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {i18n.t("options.translation.translationQueue.batchQueueConfig.title")}
            <BatchSavingsNote />
          </span>
        }
        description={i18n.t(
          "options.translation.translationQueue.batchQueueConfig.maxCharactersPerBatch.description",
        )}
      >
        <BatchNumberInput property="maxCharactersPerBatch" />
      </ConfigItem>
      <ConfigItem
        description={i18n.t(
          "options.translation.translationQueue.batchQueueConfig.maxItemsPerBatch.description",
        )}
      >
        <BatchNumberInput property="maxItemsPerBatch" />
      </ConfigItem>
      <ConfigItem
        description={i18n.t(
          "options.translation.translationQueue.batchQueueConfig.minItemsPerBatch.description",
        )}
      >
        <BatchNumberInput property="minItemsPerBatch" />
      </ConfigItem>
      <ConfigItem
        description={i18n.t(
          "options.translation.translationQueue.batchQueueConfig.batchDelay.description",
        )}
      >
        <BatchNumberInput property="batchDelay" />
      </ConfigItem>
    </>
  )
}

function BatchNumberInput({ property }: { property: KeyOfBatchQueueConfig }) {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.pageTranslation)

  return (
    <BatchQueueNumberInput
      property={property}
      value={translateConfig.batchQueueConfig[property]}
      min={propertyMinValue[property]}
      onCommit={(newConfigValue) => {
        // Persisting is enough: the background watches the stored config
        // and applies queue changes itself (no droppable message).
        void setTranslateConfig({
          batchQueueConfig: {
            ...translateConfig.batchQueueConfig,
            [property]: newConfigValue,
          },
        })
      }}
    />
  )
}
