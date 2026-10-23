/**
 * CSS Linter
 *
 * Provides CSS syntax validation.
 * Can be used standalone for validation outside the editor.
 */

import * as csstree from "css-tree"

export interface CSSLintError {
  message: string
  line: number
  column: number
  severity: "error" | "warning"
}

export interface CSSLintResult {
  valid: boolean
  errors: CSSLintError[]
}

/**
 * Lint CSS and return errors
 * Can be used standalone without CodeMirror
 */
export function lintCSS(css: string): CSSLintResult {
  const errors: CSSLintError[] = []

  if (!css.trim()) {
    return { valid: true, errors: [] }
  }

  try {
    // Parse CSS with strict mode to catch all errors
    csstree.parse(css, {
      parseAtrulePrelude: true,
      parseRulePrelude: true,
      parseValue: true,
      parseCustomProperty: true,
      onParseError: (error) => {
        const err = error as any
        errors.push({
          message: error.message,
          line: err.line || 1,
          column: err.column || 1,
          severity: "error",
        })
      },
    })

    // If parsing succeeded but there were errors in onParseError, the CSS is invalid
    // css-tree can recover from some errors, but we want to report them all
  } catch (error) {
    // Catch fatal parsing errors (e.g., completely broken CSS)
    const err = error as any
    errors.push({
      message: err.message || `Failed to parse CSS: ${(error as Error).message}`,
      line: err.line || 1,
      column: err.column || 1,
      severity: "error",
    })
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
