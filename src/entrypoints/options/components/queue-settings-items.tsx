import type { ReactNode } from "react"
import type { BatchQueueConfig, RequestQueueConfig } from "@/types/config/translate"
import {
  MIN_BATCH_CHARACTERS,
  MIN_BATCH_DELAY_SECONDS,
  MIN_BATCH_ITEMS,
  MIN_TRANSLATE_CAPACITY,
  MIN_TRANSLATE_RATE,
} from "@/utils/constants/translate"
import { BatchSavingsNote } from "./batch-savings-note"
import { ConfigItem } from "./config-item"
import { BatchQueueNumberInput, RequestRateNumberInput } from "./queue-number-inputs"

const batchPropertyMinValue = {
  maxCharactersPerBatch: MIN_BATCH_CHARACTERS,
  maxItemsPerBatch: MIN_BATCH_ITEMS,
  minItemsPerBatch: MIN_BATCH_ITEMS,
  batchDelay: MIN_BATCH_DELAY_SECONDS,
}

const ratePropertyMinValue = {
  capacity: MIN_TRANSLATE_CAPACITY,
  rate: MIN_TRANSLATE_RATE,
}

/**
 * The rate rows shared by the page-translation and video-subtitles queue pages,
 * which differ only in which config section they read and write. Strings are
 * translated by the caller so the i18n keys stay typed literals at one place.
 */
export function RequestRateItems({
  sectionId,
  title,
  capacityDescription,
  rateDescription,
  requestQueueConfig,
  onRequestQueueConfigChange,
}: {
  sectionId: string
  title: string
  capacityDescription: string
  rateDescription: string
  requestQueueConfig: RequestQueueConfig
  onRequestQueueConfigChange: (requestQueueConfig: RequestQueueConfig) => void
}) {
  return (
    <>
      <ConfigItem id={sectionId} title={title} description={capacityDescription}>
        <RateInput
          property="capacity"
          requestQueueConfig={requestQueueConfig}
          onRequestQueueConfigChange={onRequestQueueConfigChange}
        />
      </ConfigItem>
      <ConfigItem description={rateDescription}>
        <RateInput
          property="rate"
          requestQueueConfig={requestQueueConfig}
          onRequestQueueConfigChange={onRequestQueueConfigChange}
        />
      </ConfigItem>
    </>
  )
}

function RateInput({
  property,
  requestQueueConfig,
  onRequestQueueConfigChange,
}: {
  property: keyof RequestQueueConfig
  requestQueueConfig: RequestQueueConfig
  onRequestQueueConfigChange: (requestQueueConfig: RequestQueueConfig) => void
}) {
  return (
    <RequestRateNumberInput
      property={property}
      value={requestQueueConfig[property]}
      min={ratePropertyMinValue[property]}
      onCommit={(newConfigValue) => {
        // Persisting is enough: the background watches the stored config
        // and applies queue changes itself (no droppable message).
        onRequestQueueConfigChange({
          ...requestQueueConfig,
          [property]: newConfigValue,
        })
      }}
    />
  )
}

/**
 * The batch rows shared by the two queue pages. `extraItems` lets a page append
 * its own rows under the same section (subtitles adds the look-ahead input).
 */
export function BatchQueueItems({
  sectionId,
  title,
  maxCharactersPerBatchDescription,
  maxItemsPerBatchDescription,
  minItemsPerBatchDescription,
  batchDelayDescription,
  batchQueueConfig,
  onBatchQueueConfigChange,
  extraItems,
}: {
  sectionId: string
  title: string
  maxCharactersPerBatchDescription: string
  maxItemsPerBatchDescription: string
  minItemsPerBatchDescription: string
  batchDelayDescription: string
  batchQueueConfig: BatchQueueConfig
  onBatchQueueConfigChange: (batchQueueConfig: BatchQueueConfig) => void
  extraItems?: ReactNode
}) {
  return (
    <>
      <ConfigItem
        id={sectionId}
        title={
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {title}
            <BatchSavingsNote />
          </span>
        }
        description={maxCharactersPerBatchDescription}
      >
        <BatchInput
          property="maxCharactersPerBatch"
          batchQueueConfig={batchQueueConfig}
          onBatchQueueConfigChange={onBatchQueueConfigChange}
        />
      </ConfigItem>
      <ConfigItem description={maxItemsPerBatchDescription}>
        <BatchInput
          property="maxItemsPerBatch"
          batchQueueConfig={batchQueueConfig}
          onBatchQueueConfigChange={onBatchQueueConfigChange}
        />
      </ConfigItem>
      <ConfigItem description={minItemsPerBatchDescription}>
        <BatchInput
          property="minItemsPerBatch"
          batchQueueConfig={batchQueueConfig}
          onBatchQueueConfigChange={onBatchQueueConfigChange}
        />
      </ConfigItem>
      <ConfigItem description={batchDelayDescription}>
        <BatchInput
          property="batchDelay"
          batchQueueConfig={batchQueueConfig}
          onBatchQueueConfigChange={onBatchQueueConfigChange}
        />
      </ConfigItem>
      {extraItems}
    </>
  )
}

function BatchInput({
  property,
  batchQueueConfig,
  onBatchQueueConfigChange,
}: {
  property: keyof BatchQueueConfig
  batchQueueConfig: BatchQueueConfig
  onBatchQueueConfigChange: (batchQueueConfig: BatchQueueConfig) => void
}) {
  return (
    <BatchQueueNumberInput
      property={property}
      value={batchQueueConfig[property]}
      min={batchPropertyMinValue[property]}
      onCommit={(newConfigValue) => {
        onBatchQueueConfigChange({
          ...batchQueueConfig,
          [property]: newConfigValue,
        })
      }}
    />
  )
}
