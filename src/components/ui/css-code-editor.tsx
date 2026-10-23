/**
 * CSS Code Editor Component
 *
 * Lightweight code editor for CSS with syntax highlighting and theme support.
 * Syntax validation is owned by callers (see CustomCssEditor) via `hasError`.
 */

import { BaseCodeEditor, type BaseCodeEditorProps } from "./base-code-editor"

interface CSSCodeEditorProps extends Omit<BaseCodeEditorProps, "language"> {}

export function CSSCodeEditor({ hasError, ...props }: CSSCodeEditorProps) {
  return <BaseCodeEditor hasError={hasError} {...props} language="css" />
}

CSSCodeEditor.displayName = "CSSCodeEditor"
