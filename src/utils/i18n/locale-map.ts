import { browser } from "#imports"
import type { UiLanguage } from "@/types/config/config"
import type { SupportedUiLocale } from "./resources"
import { DEFAULT_UI_LOCALE, SUPPORTED_UI_LOCALES } from "./resources"

const SUPPORTED = new Set<string>(SUPPORTED_UI_LOCALES)

/**
 * Resolve the stored `uiLanguage` config value to a concrete supported locale.
 *
 * - explicit locale (e.g. "zh-CN") → passed through
 * - "auto" → nearest match for the browser UI language:
 *     zh-*  → "zh-CN" (the only bundled Chinese locale)
 *     exact → e.g. "en" stays "en"
 *     prefix→ e.g. "en-US" → "en"
 *     else  → "en"
 *
 * Guarded so it degrades to "en" when `browser.i18n` is unavailable (e.g. tests).
 */
export function resolveUiLocale(uiLanguage: UiLanguage): SupportedUiLocale {
  if (uiLanguage !== "auto") {
    return uiLanguage
  }
  return resolveBrowserLocale()
}

function resolveBrowserLocale(): SupportedUiLocale {
  let uiLanguage: string
  try {
    // e.g. "en-US", "zh-CN", "ja"
    uiLanguage = browser.i18n.getUILanguage()
  } catch {
    return DEFAULT_UI_LOCALE
  }

  const lower = uiLanguage.toLowerCase()
  const [prefix] = lower.split("-")

  if (prefix === "zh") {
    // All zh-* regions resolve to the single bundled Simplified Chinese locale.
    return "zh-CN"
  }

  // Exact match against a supported locale (case-insensitive).
  const exact = SUPPORTED_UI_LOCALES.find((locale) => locale.toLowerCase() === lower)
  if (exact) {
    return exact
  }

  // Prefix match: "en-US" → "en".
  if (SUPPORTED.has(prefix!)) {
    return prefix as SupportedUiLocale
  }

  return DEFAULT_UI_LOCALE
}
