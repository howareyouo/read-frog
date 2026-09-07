import { useAtom } from "jotai"
import type { RequestQueueConfig } from "@/types/config/translate"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { MIN_TRANSLATE_CAPACITY, MIN_TRANSLATE_RATE } from "@/utils/constants/translate"
import { i18n } from "@/utils/i18n"
import { ConfigItem } from "../../../components/config-item"
import { RequestRateNumberInput } from "../../../components/queue-number-inputs"

type KeyOfRequestQueueConfig = keyof RequestQueueConfig

const propertyMinAllowedValue = {
  capacity: MIN_TRANSLATE_CAPACITY,
  rate: MIN_TRANSLATE_RATE,
}

/** How fast requests leave: a burst allowance, then the steady pace it refills at. */
export function RequestRateItems() {
  return (
    <>
      <ConfigItem
        id="request-rate"
        title={i18n.t("options.translation.translationQueue.requestQueueConfig.title")}
        description={i18n.t(
          "options.translation.translationQueue.requestQueueConfig.capacity.description",
        )}
      >
        <TranslateNumberInput property="capacity" />
      </ConfigItem>
      <ConfigItem
        description={i18n.t(
          "options.translation.translationQueue.requestQueueConfig.rate.description",
        )}
      >
        <TranslateNumberInput property="rate" />
      </ConfigItem>
    </>
  )
}

function TranslateNumberInput({ property }: { property: KeyOfRequestQueueConfig }) {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.pageTranslation)

  return (
    <RequestRateNumberInput
      property={property}
      value={translateConfig.requestQueueConfig[property]}
      min={propertyMinAllowedValue[property]}
      onCommit={(newConfigValue) => {
        // Persisting is enough: the background watches the stored config
        // and applies queue changes itself (no droppable message).
        void setTranslateConfig({
          requestQueueConfig: {
            ...translateConfig.requestQueueConfig,
            [property]: newConfigValue,
          },
        })
      }}
    />
  )
}
