/**
 * Subtitle custom CSS editor.
 *
 * The sibling of the page-translation editor, with one difference that shows: the draft lives on
 * the page rather than here, because the preview above renders from it live and the preset dropdown
 * writes into it. Saving is still explicit — a stylesheet is worth committing on purpose.
 */
import { deepmerge } from "deepmerge-ts"
import { useAtom } from "jotai"
import { CustomCssEditor } from "@/entrypoints/options/components/custom-css-editor"
import { configFieldsAtomMap } from "@/utils/atoms/config"

const I18N_PREFIX = "options.videoSubtitles.style.customCSS.editor"

interface CSSEditorProps {
  value: string
  onChange: (value: string) => void
}

export function CSSEditor({ value, onChange }: CSSEditorProps) {
  const [videoSubtitlesConfig, setVideoSubtitlesConfig] = useAtom(
    configFieldsAtomMap.videoSubtitles,
  )
  const savedCSS = videoSubtitlesConfig.style.customCSS ?? ""

  return (
    <CustomCssEditor
      i18nPrefix={I18N_PREFIX}
      docsPath="/docs/subtitle-custom-css"
      value={value}
      onChange={onChange}
      savedValue={savedCSS}
      onSave={() => {
        // Cleared back to empty means off, and the schema spells that `null` rather than `""`.
        const customCSS = value.trim() ? value : null
        void setVideoSubtitlesConfig(deepmerge(videoSubtitlesConfig, { style: { customCSS } }))
      }}
    />
  )
}
