/**
 * Shared lightweight code editor shell for the language-specific code editors.
 *
 * react-simple-code-editor (a transparent textarea over Prism-highlighted
 * output) keeps the bundle a fraction of the CodeMirror stack while still
 * providing line numbers, syntax highlighting, undo and Tab insertion. The
 * language wrappers only supply the Prism grammar via `language`.
 */
import Prism from "prismjs"
import { useId } from "react"
import Editor from "react-simple-code-editor"
import { cn } from "@/utils/styles/utils"
import "prismjs/components/prism-css"
import "prismjs/components/prism-json"
import "@/assets/styles/code-editor.css"

export type CodeEditorLanguage = "css" | "json"

export interface BaseCodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language: CodeEditorLanguage
  placeholder?: string
  editable?: boolean
  hasError?: boolean
  className?: string
  /** Fixed height for the scrollable editor body; without it the editor grows with content. */
  height?: string
  onFocus?: React.FocusEventHandler<HTMLTextAreaElement>
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>
  "aria-label"?: string
}

type FocusHandlers = React.FocusEventHandler<HTMLDivElement> &
  React.FocusEventHandler<HTMLTextAreaElement>

const GRAMMARS: Record<CodeEditorLanguage, Prism.Grammar> = {
  css: Prism.languages.css as Prism.Grammar,
  json: Prism.languages.json as Prism.Grammar,
}

export function BaseCodeEditor({
  value,
  onChange,
  language,
  placeholder,
  editable = true,
  hasError,
  className,
  height,
  onFocus,
  onBlur,
  "aria-label": ariaLabel,
}: BaseCodeEditorProps) {
  const textareaId = useId()
  const lineCount = (value || "").split("\n").length
  const readOnly = !editable

  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-md border bg-transparent",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        hasError &&
          "border-destructive focus-within:border-destructive focus-within:ring-destructive/50",
        readOnly && "cursor-not-allowed opacity-50",
        className,
      )}
      style={height ? { height } : undefined}
    >
      <div className="code-editor-highlight flex min-h-0 w-full min-w-0 flex-1 overflow-auto">
        <div
          aria-hidden
          className="sticky left-0 z-10 shrink-0 select-none border-r bg-background pt-[10px] pb-2 text-right text-sm text-muted-foreground/70"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              // Keep in sync with the editor's font metrics and padding below.
              className="pr-2 pl-3 leading-[21px]"
            >
              {i + 1}
            </div>
          ))}
        </div>
        <Editor
          id={textareaId}
          aria-label={ariaLabel}
          value={value}
          onValueChange={onChange ?? (() => {})}
          highlight={(code) => Prism.highlight(code, GRAMMARS[language], language)}
          placeholder={placeholder}
          readOnly={readOnly}
          ignoreTabKey={readOnly}
          onFocus={onFocus as FocusHandlers | undefined}
          onBlur={onBlur as FocusHandlers | undefined}
          padding={10}
          className="min-w-0 flex-1"
          preClassName="whitespace-pre"
          textareaClassName="whitespace-pre"
          style={{
            fontSize: 14,
            lineHeight: "21px",
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", "Courier New", monospace',
          }}
        />
      </div>
    </div>
  )
}

BaseCodeEditor.displayName = "BaseCodeEditor"
