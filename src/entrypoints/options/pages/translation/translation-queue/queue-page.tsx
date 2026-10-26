import { useAtom } from "jotai"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { ConfigDetailSection } from "../../../components/config-detail-section"
import { PageLayout } from "../../../components/page-layout"
import { BatchQueueItems, RequestRateItems } from "../../../components/queue-settings-items"
import { PreloadItems } from "./preload-items"

/**
 * Drilled into from the Translation page: how fast requests go out, how much text each carries,
 * and how far ahead of the reader they run. Every one of them trades speed against API cost.
 */
export function TranslationQueuePage() {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.pageTranslation)

  return (
    <PageLayout
      title={i18n.t("options.translation.title")}
      description={i18n.t("options.translation.pageDescription")}
    >
      <ConfigDetailSection
        backTo="/page-translation"
        title={
          <span id="translation-queue">{i18n.t("options.translation.translationQueue.title")}</span>
        }
      >
        <RequestRateItems
          sectionId="request-rate"
          title={i18n.t("options.translation.translationQueue.requestQueueConfig.title")}
          capacityDescription={i18n.t(
            "options.translation.translationQueue.requestQueueConfig.capacity.description",
          )}
          rateDescription={i18n.t(
            "options.translation.translationQueue.requestQueueConfig.rate.description",
          )}
          requestQueueConfig={translateConfig.requestQueueConfig}
          onRequestQueueConfigChange={(requestQueueConfig) => {
            void setTranslateConfig({ requestQueueConfig })
          }}
        />
        <BatchQueueItems
          sectionId="request-batch"
          title={i18n.t("options.translation.translationQueue.batchQueueConfig.title")}
          maxCharactersPerBatchDescription={i18n.t(
            "options.translation.translationQueue.batchQueueConfig.maxCharactersPerBatch.description",
          )}
          maxItemsPerBatchDescription={i18n.t(
            "options.translation.translationQueue.batchQueueConfig.maxItemsPerBatch.description",
          )}
          minItemsPerBatchDescription={i18n.t(
            "options.translation.translationQueue.batchQueueConfig.minItemsPerBatch.description",
          )}
          batchDelayDescription={i18n.t(
            "options.translation.translationQueue.batchQueueConfig.batchDelay.description",
          )}
          batchQueueConfig={translateConfig.batchQueueConfig}
          onBatchQueueConfigChange={(batchQueueConfig) => {
            void setTranslateConfig({ batchQueueConfig })
          }}
        />
        <PreloadItems />
      </ConfigDetailSection>
    </PageLayout>
  )
}
