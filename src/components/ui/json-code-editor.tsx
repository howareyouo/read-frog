/**
 * JSON Code Editor Component
 *
 * Lightweight code editor for JSON with syntax highlighting and theme support.
 * Syntax errors are surfaced by callers (JSON.parse validation) via `hasError`.
 */

import { BaseCodeEditor, type BaseCodeEditorProps } from "./base-code-editor"

interface JSONCodeEditorProps extends Omit<BaseCodeEditorProps, "language"> {}

export function JSONCodeEditor({ hasError, ...props }: JSONCodeEditorProps) {
  return <BaseCodeEditor hasError={hasError} {...props} language="json" />
}

JSONCodeEditor.displayName = "JSONCodeEditor"
