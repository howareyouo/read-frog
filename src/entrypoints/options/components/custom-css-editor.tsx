/**
 * Shared custom-CSS editor shell used by the page-translation and
 * video-subtitles style pages.
 *
 * Owns everything the two pages had duplicated verbatim: the docs link, the
 * debounced CSS syntax/length validation and its message row, and the explicit
 * save button. The caller owns the draft state (controlled or uncontrolled —
 * the subtitles page keeps its draft on the page because its live preview and
 * the preset dropdown write into it) and the persistence shape (the subtitles
 * schema spells "off" as `null`, the translation one keeps `""`).
 */
import { useMemo } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { Field } from "@/components/ui/base-ui/field"
import { CSSCodeEditor } from "@/components/ui/css-code-editor"
import { env } from "@/env"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { MAX_CUSTOM_CSS_LENGTH } from "@/types/config/translate"
import { lintCSS } from "@/utils/css/lint-css"
import type { I18nKey } from "@/utils/i18n"
import { i18n } from "@/utils/i18n"
import { cn } from "@/utils/styles/utils"

/**
 * Literal i18n keys per page prefix. Built as a table (rather than template-string
 * construction) so every key is checked against the generated `I18nKey` union.
 */
const EDITOR_I18N_KEYS = {
  "options.translation.translationStyle.customCSS.editor": {
    docsLink: "options.translation.translationStyle.customCSS.editor.docsLink",
    placeholder: "options.translation.translationStyle.customCSS.editor.placeholder",
    saveButton: "options.translation.translationStyle.customCSS.editor.saveButton",
    savedButton: "options.translation.translationStyle.customCSS.editor.savedButton",
    "validation.validating":
      "options.translation.translationStyle.customCSS.editor.validation.validating",
    "validation.syntaxError":
      "options.translation.translationStyle.customCSS.editor.validation.syntaxError",
    "validation.tooLong":
      "options.translation.translationStyle.customCSS.editor.validation.tooLong",
    "validation.saved": "options.translation.translationStyle.customCSS.editor.validation.saved",
    "validation.valid": "options.translation.translationStyle.customCSS.editor.validation.valid",
  },
  "options.videoSubtitles.style.customCSS.editor": {
    docsLink: "options.videoSubtitles.style.customCSS.editor.docsLink",
    placeholder: "options.videoSubtitles.style.customCSS.editor.placeholder",
    saveButton: "options.videoSubtitles.style.customCSS.editor.saveButton",
    savedButton: "options.videoSubtitles.style.customCSS.editor.savedButton",
    "validation.validating": "options.videoSubtitles.style.customCSS.editor.validation.validating",
    "validation.syntaxError":
      "options.videoSubtitles.style.customCSS.editor.validation.syntaxError",
    "validation.tooLong": "options.videoSubtitles.style.customCSS.editor.validation.tooLong",
    "validation.saved": "options.videoSubtitles.style.customCSS.editor.validation.saved",
    "validation.valid": "options.videoSubtitles.style.customCSS.editor.validation.valid",
  },
} as const satisfies Record<string, Record<string, I18nKey>>

type CssEditorI18nPrefix = keyof typeof EDITOR_I18N_KEYS
type CssEditorKeySuffix = keyof (typeof EDITOR_I18N_KEYS)[CssEditorI18nPrefix]

function editorKey(prefix: CssEditorI18nPrefix, suffix: CssEditorKeySuffix) {
  return i18n.t(EDITOR_I18N_KEYS[prefix][suffix])
}

interface CustomCssEditorProps {
  i18nPrefix: CssEditorI18nPrefix
  /** Docs path under the website root, e.g. `/docs/custom-css`. */
  docsPath: string
  value: string
  onChange: (value: string) => void
  /** The last persisted value, used to compute the "has changes" state. */
  savedValue: string
  /** Called only when the value passes validation and differs from `savedValue`. */
  onSave: () => void
}

export function CustomCssEditor({
  i18nPrefix,
  docsPath,
  value,
  onChange,
  savedValue,
  onSave,
}: CustomCssEditorProps) {
  // Debounce CSS input for validation
  const debouncedCssInput = useDebouncedValue(value, 500)

  // Check CSS syntax using linter
  // Wrap with a dummy selector so css-tree can parse it properly
  const syntaxCheck = useMemo(() => {
    if (!debouncedCssInput.trim()) {
      return { valid: true, errors: [] }
    }
    return lintCSS(debouncedCssInput)
  }, [debouncedCssInput])

  // Check CSS length
  const hasLengthError = debouncedCssInput.length > MAX_CUSTOM_CSS_LENGTH
  const hasSyntaxError = !syntaxCheck.valid
  const isValidating = value !== debouncedCssInput
  const hasChanges = value !== savedValue

  return (
    <Field>
      {/* The section heading already names this editor, so the row carries only the docs link. */}
      <div className="flex items-start justify-end">
        <a
          href={`${env.WXT_WEBSITE_URL}${docsPath}`}
          className="text-xs text-link hover:opacity-90"
          target="_blank"
          rel="noreferrer"
        >
          {editorKey(i18nPrefix, "docsLink")}
        </a>
      </div>
      <CSSCodeEditor
        value={value}
        onChange={onChange}
        hasError={hasSyntaxError || hasLengthError}
        placeholder={editorKey(i18nPrefix, "placeholder")}
        className="max-h-[400px] min-h-[200px] overflow-y-auto"
      />
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            "text-sm text-green-500",
            isValidating && "text-muted-foreground",
            (hasSyntaxError || hasLengthError) && "text-destructive",
          )}
        >
          {value.trim().length > 0
            ? getValidationMessage(
                i18nPrefix,
                isValidating,
                hasSyntaxError,
                hasLengthError,
                hasChanges,
              )
            : ""}
        </div>
        <Button
          onClick={() => {
            // Must pass syntax check and length check
            if (hasSyntaxError || hasLengthError || isValidating || !hasChanges) {
              return
            }
            onSave()
          }}
          disabled={isValidating || hasSyntaxError || hasLengthError || !hasChanges}
        >
          {hasChanges ? editorKey(i18nPrefix, "saveButton") : editorKey(i18nPrefix, "savedButton")}
        </Button>
      </div>
    </Field>
  )
}

function getValidationMessage(
  i18nPrefix: CssEditorI18nPrefix,
  isValidating: boolean,
  hasSyntaxError: boolean,
  hasLengthError: boolean,
  hasChanges: boolean,
) {
  if (isValidating) {
    return editorKey(i18nPrefix, "validation.validating")
  }

  if (hasSyntaxError) {
    return editorKey(i18nPrefix, "validation.syntaxError")
  }

  if (hasLengthError) {
    return editorKey(i18nPrefix, "validation.tooLong")
  }

  if (!hasChanges) {
    return editorKey(i18nPrefix, "validation.saved")
  }

  return editorKey(i18nPrefix, "validation.valid")
}
