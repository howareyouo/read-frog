/**
 * CSS Code Editor Component
 *
 * CodeMirror-based code editor for CSS with syntax highlighting and theme support.
 * Uses @uiw/react-codemirror with @codemirror/lang-css for rich editing experience.
 */

import { css } from "@codemirror/lang-css"
import { lintGutter } from "@codemirror/lint"
import { color } from "@uiw/codemirror-extensions-color"
import { cssLinter } from "@/utils/css/lint-css"
import { BaseCodeEditor, type BaseCodeEditorProps } from "./base-code-editor"

interface CSSCodeEditorProps extends BaseCodeEditorProps {}

export function CSSCodeEditor({ hasError, ...props }: CSSCodeEditorProps) {
  return (
    <BaseCodeEditor
      hasError={hasError}
      extensions={[
        color,
        css(),
        // CSS syntax linter - shows red squiggly lines for errors
        cssLinter(),
        lintGutter(),
      ]}
      {...props}
    />
  )
}

CSSCodeEditor.displayName = "CSSCodeEditor"
