/// <reference types="@modyfi/vite-plugin-yaml/modules" />
import en from "@/locales/en.yml"
import zhCN from "@/locales/zh-CN.yml"

/**
 * The interface languages the runtime i18n engine can switch between.
 *
 * MUST stay in sync with the `uiLanguage` enum in `@/types/config/config` and the
 * files under `src/locales/`. `@wxt-dev/i18n/module` still reads those same files to
 * emit `_locales/*` for manifest name/description localization (browser-locale-bound).
 *
 * Only English and Simplified Chinese are bundled: the other languages were
 * removed to slim the extension — each content script inlines the full resource
 * set (WXT builds content scripts as individual IIFEs), so every extra locale
 * is multiplied across host/selection/side/subtitles.
 */
export const SUPPORTED_UI_LOCALES = ["en", "zh-CN"] as const

export type SupportedUiLocale = (typeof SUPPORTED_UI_LOCALES)[number]

export const DEFAULT_UI_LOCALE: SupportedUiLocale = "en"

export interface LocaleTree {
  [key: string]: string | LocaleTree
}

/**
 * Convert WXT-style positional substitutions to indexed interpolation, applied to
 * every string leaf at build time:
 *   - `$$`      → literal `$`   (WXT escape; none currently in the YAML, handled anyway)
 *   - `$1`..`$9`→ `{{0}}`..`{{8}}` (0-indexed to match the facade's array mapping)
 *
 * Intentionally left untouched:
 *   - existing named tokens like `{{targetLanguage}}` (LLM prompt templates; no `$`)
 *   - Chrome context-menu placeholders like `%s`
 */
function convertPlaceholders(value: string): string {
  return value.replace(/\$\$|\$(\d)/g, (_match, digit: string | undefined) =>
    digit === undefined ? "$" : `{{${Number(digit) - 1}}}`,
  )
}

function convertTree(node: LocaleTree): LocaleTree {
  const out: LocaleTree = {}
  for (const [key, val] of Object.entries(node)) {
    out[key] = typeof val === "string" ? convertPlaceholders(val) : convertTree(val)
  }
  return out
}

const rawDictionaries: Record<SupportedUiLocale, LocaleTree> = {
  en,
  "zh-CN": zhCN,
}

/**
 * Nested string trees per locale, keyed with "." separators (e.g. `menu.openTitle`).
 */
export const dictionaries: Record<SupportedUiLocale, LocaleTree> = Object.fromEntries(
  Object.entries(rawDictionaries).map(([lng, tree]) => [lng, convertTree(tree)]),
) as Record<SupportedUiLocale, LocaleTree>
