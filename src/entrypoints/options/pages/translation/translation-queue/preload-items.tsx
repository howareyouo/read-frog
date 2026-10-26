import { useAtom } from "jotai"
import type { PreloadConfig } from "@/types/config/translate"
import { preloadConfigSchema } from "@/types/config/translate"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import {
  MAX_PRELOAD_MARGIN,
  MAX_PRELOAD_THRESHOLD,
  MIN_PRELOAD_MARGIN,
  MIN_PRELOAD_THRESHOLD,
} from "@/utils/constants/translate"
import { i18n } from "@/utils/i18n"
import { ConfigItem } from "../../../components/config-item"
import { SchemaNumberInput } from "../../../components/queue-number-inputs"

type KeyOfPreloadConfig = keyof PreloadConfig

/** How far ahead of the reader translation runs — the distance, and how much of a paragraph counts as reached. */
export function PreloadItems() {
  return (
    <>
      <ConfigItem
        id="preload-config"
        title={i18n.t("options.translation.translationQueue.preloadConfig.title")}
        description={i18n.t(
          "options.translation.translationQueue.preloadConfig.margin.description",
        )}
      >
        <PreloadNumberInput property="margin" />
      </ConfigItem>
      <ConfigItem
        description={i18n.t(
          "options.translation.translationQueue.preloadConfig.threshold.description",
        )}
      >
        <PreloadNumberInput property="threshold" />
      </ConfigItem>
    </>
  )
}

const propertyConstraints = {
  margin: { min: MIN_PRELOAD_MARGIN, max: MAX_PRELOAD_MARGIN, step: 100 },
  threshold: { min: MIN_PRELOAD_THRESHOLD, max: MAX_PRELOAD_THRESHOLD, step: 0.1 },
}

function PreloadNumberInput({ property }: { property: KeyOfPreloadConfig }) {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.pageTranslation)
  const { preload } = translateConfig.page
  const constraints = propertyConstraints[property]

  return (
    <SchemaNumberInput
      schema={preloadConfigSchema}
      property={property}
      value={preload[property]}
      min={constraints.min}
      max={constraints.max}
      step={constraints.step}
      onCommit={(newConfigValue) => {
        void setTranslateConfig({
          page: {
            ...translateConfig.page,
            preload: { ...preload, [property]: newConfigValue },
          },
        })
      }}
    />
  )
}
