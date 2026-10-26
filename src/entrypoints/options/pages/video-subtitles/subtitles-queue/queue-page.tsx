import { useAtom } from "jotai"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { ConfigDetailSection } from "../../../components/config-detail-section"
import { PageLayout } from "../../../components/page-layout"
import { BatchQueueItems, RequestRateItems } from "../../../components/queue-settings-items"
import { LookAheadItem } from "./look-ahead-item"

/**
 * Drilled into from the Video Subtitles page: how fast subtitle requests go out and how many
 * lines each carries. Both trade the speed subtitles catch up at against API cost.
 */
export function SubtitlesQueuePage() {
  const [videoSubtitlesConfig, setVideoSubtitlesConfig] = useAtom(
    configFieldsAtomMap.videoSubtitles,
  )

  return (
    <PageLayout
      title={i18n.t("options.videoSubtitles.title")}
      description={i18n.t("options.videoSubtitles.pageDescription")}
    >
      <ConfigDetailSection
        backTo="/video-subtitles"
        title={
          <span id="subtitles-queue">{i18n.t("options.videoSubtitles.subtitlesQueue.title")}</span>
        }
      >
        <RequestRateItems
          sectionId="subtitles-request-rate"
          title={i18n.t("options.videoSubtitles.subtitlesQueue.requestQueueConfig.title")}
          capacityDescription={i18n.t(
            "options.videoSubtitles.subtitlesQueue.requestQueueConfig.capacity.description",
          )}
          rateDescription={i18n.t(
            "options.videoSubtitles.subtitlesQueue.requestQueueConfig.rate.description",
          )}
          requestQueueConfig={videoSubtitlesConfig.requestQueueConfig}
          onRequestQueueConfigChange={(requestQueueConfig) => {
            void setVideoSubtitlesConfig({ requestQueueConfig })
          }}
        />
        <BatchQueueItems
          sectionId="subtitles-request-batch"
          title={i18n.t("options.videoSubtitles.subtitlesQueue.batchQueueConfig.title")}
          maxCharactersPerBatchDescription={i18n.t(
            "options.videoSubtitles.subtitlesQueue.batchQueueConfig.maxCharactersPerBatch.description",
          )}
          maxItemsPerBatchDescription={i18n.t(
            "options.videoSubtitles.subtitlesQueue.batchQueueConfig.maxItemsPerBatch.description",
          )}
          minItemsPerBatchDescription={i18n.t(
            "options.videoSubtitles.subtitlesQueue.batchQueueConfig.minItemsPerBatch.description",
          )}
          batchDelayDescription={i18n.t(
            "options.videoSubtitles.subtitlesQueue.batchQueueConfig.batchDelay.description",
          )}
          batchQueueConfig={videoSubtitlesConfig.batchQueueConfig}
          onBatchQueueConfigChange={(batchQueueConfig) => {
            void setVideoSubtitlesConfig({ batchQueueConfig })
          }}
          extraItems={<LookAheadItem />}
        />
      </ConfigDetailSection>
    </PageLayout>
  )
}
