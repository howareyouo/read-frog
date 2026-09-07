/**
 * Shared CodeMirror shell for the language-specific code editors.
 *
 * Hosts the styling, theme wiring and `basicSetup` that every editor here
 * shares; language wrappers only supply their `extensions`.
 */
import type { ReactCodeMirrorProps } from "@uiw/react-codemirror"
import CodeMirror from "@uiw/react-codemirror"
import { useTheme } from "@/components/providers/theme-provider"
import { cn } from "@/utils/styles/utils"

export interface BaseCodeEditorProps extends Omit<ReactCodeMirrorProps, "theme"> {
  hasError?: boolean
}

export function BaseCodeEditor({
  hasError,
  className,
  editable = true,
  extensions,
  ...props
}: BaseCodeEditorProps) {
  const { theme } = useTheme()

  return (
    <CodeMirror
      extensions={extensions}
      theme={theme}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLineGutter: true,
        highlightActiveLine: true,
        foldGutter: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        syntaxHighlighting: true,
      }}
      className={cn(
        "overflow-hidden rounded-md border",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        hasError &&
          "border-destructive focus-within:border-destructive focus-within:ring-destructive/50",
        !editable && "cursor-not-allowed opacity-50",
        className,
      )}
      style={{
        fontSize: 14,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", "Courier New", monospace',
      }}
      editable={editable}
      {...props}
    />
  )
}

BaseCodeEditor.displayName = "BaseCodeEditor"
