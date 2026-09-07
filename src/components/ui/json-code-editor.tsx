/**
 * JSON Code Editor Component
 *
 * CodeMirror-based code editor for JSON with syntax highlighting and theme support.
 * Uses @uiw/react-codemirror with @codemirror/lang-json for rich editing experience.
 */

import { json, jsonParseLinter } from "@codemirror/lang-json"
import { linter, lintGutter } from "@codemirror/lint"
import { BaseCodeEditor, type BaseCodeEditorProps } from "./base-code-editor"

// Custom linter that allows empty content (jsonParseLinter throws on empty string)
const allowEmptyJsonLinter = linter((view) => {
  const content = view.state.doc.toString().trim()
  if (!content) {
    return []
  }
  return jsonParseLinter()(view)
})

interface JSONCodeEditorProps extends BaseCodeEditorProps {}

export function JSONCodeEditor({ hasError, ...props }: JSONCodeEditorProps) {
  return (
    <BaseCodeEditor
      hasError={hasError}
      extensions={[json(), allowEmptyJsonLinter, lintGutter()]}
      {...props}
    />
  )
}

JSONCodeEditor.displayName = "JSONCodeEditor"
