/**
 * CSS Editor Section Component (page translation)
 *
 * Thin wrapper over the shared CustomCssEditor: owns the draft state and
 * persists `customCSS` as-is ("" included) to keep the user's formatting.
 */
import { useAtom } from "jotai"
import { useContext, useState } from "react"
import { CustomCssEditor } from "@/entrypoints/options/components/custom-css-editor"
import { configFieldsAtomMap } from "@/utils/atoms/config"

const I18N_PREFIX = "options.translation.translationStyle.customCSS.editor"

export function CSSEditor() {
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.pageTranslation)
  const savedCSS = translateConfig.translationNodeStyle.customCSS ?? ""
  const [cssInput, setCssInput] = useState(savedCSS)

  return (
    <CustomCssEditor
      i18nPrefix={I18N_PREFIX}
      docsPath="/docs/custom-css"
      value={cssInput}
      onChange={setCssInput}
      savedValue={savedCSS}
      onSave={() => {
        void setTranslateConfig({
          ...translateConfig,
          translationNodeStyle: {
            ...translateConfig.translationNodeStyle,
            customCSS: cssInput,
          },
        })
      }}
    />
  )
}
