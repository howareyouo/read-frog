import type { GeneratedI18nStructure } from "#i18n"
import type { UiLanguage } from "@/types/config/config"
import { resolveUiLocale } from "./locale-map"
import type { LocaleTree, SupportedUiLocale } from "./resources"
import { DEFAULT_UI_LOCALE, dictionaries } from "./resources"

/**
 * Runtime-switchable i18n facade.
 *
 * Replaces `@wxt-dev/i18n`'s `browser.i18n.getMessage` resolution (hard-locked to the
 * browser UI language) with a nested-dictionary lookup whose language is driven by the
 * `uiLanguage` config field. Preserves the exact `i18n.t('key')` / `i18n.t('key', subs)`
 * call signature so ~800 existing call sites only change their import path.
 *
 *   config.uiLanguage ──resolveUiLocale──▶ activeLocale
 *        │ 'auto' → browser locale              ▲
 *        │ explicit → passthrough               │
 *        └────── initI18n() / setUiLanguage() ──┘
 *
 * The dictionaries for both locales are bundled and switching is a plain assignment,
 * so it is synchronous — the React `<LocaleBoundary>` relies on this to switch without
 * a flash. Keys missing in every locale resolve to "" so guards like
 * `i18n.t(key) || fallback` keep working.
 */

type Substitution = string | number

/** Build an N-length tuple of `Substitution` (positional `$1..$9` → array of N values). */
type SubstitutionTuple<N extends number, Acc extends Substitution[] = []> = Acc["length"] extends N
  ? Acc
  : SubstitutionTuple<N, [...Acc, Substitution]>

export type I18nKey = keyof GeneratedI18nStructure

/**
 * Typed `t` for the facade. Keyed off WXT's generated positional `substitutions` count
 * only — it intentionally IGNORES WXT's `namedSubstitutions`. WXT flags the LLM
 * prompt-template keys (the repo's only `namedSubstitutions` keys) because its parser
 * matches the inner `{token}` of a literal `{{token}}`, but those tokens are NOT i18n
 * substitutions: they must survive verbatim to be filled later at prompt-execution time
 * (see `replaceSelectionToolbarCustomActionPromptTokens`). Named `{{token}}` placeholders
 * are left intact below, so those keys correctly take no args here.
 */
type FacadeT = <K extends I18nKey>(
  key: K,
  ...args: GeneratedI18nStructure[K]["substitutions"] extends 0
    ? []
    : [substitutions: SubstitutionTuple<GeneratedI18nStructure[K]["substitutions"]>]
) => string

let activeLocale: SupportedUiLocale = DEFAULT_UI_LOCALE

/** The locale `t()` currently resolves keys against. */
export function getActiveLocale(): SupportedUiLocale {
  return activeLocale
}

function lookup(tree: LocaleTree, key: string): string | undefined {
  let node: string | LocaleTree | undefined = tree
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined
    }
    node = node[part]
  }
  return typeof node === "string" ? node : undefined
}

/**
 * Positional substitutions (`$1..$9`, converted to `{{0}}..{{8}}` at resource-load time)
 * arrive as an array and fill the matching indexed placeholders. Unmatched numeric
 * placeholders and named tokens (`{{selection}}` etc.) stay verbatim. No key uses
 * plurals, so no other arg shapes exist.
 */
function interpolate(template: string, substitutions?: Substitution[]): string {
  if (!substitutions || substitutions.length === 0) {
    return template
  }

  return template.replace(/\{\{(\d+)\}\}/g, (match, index: string) => {
    const value = substitutions[Number(index)]
    return value === undefined ? match : String(value)
  })
}

function rawT(key: string, substitutions?: Substitution[]): string {
  const template =
    lookup(dictionaries[activeLocale], key) ?? lookup(dictionaries[DEFAULT_UI_LOCALE], key)
  if (template === undefined) {
    return ""
  }

  return interpolate(template, substitutions)
}

/**
 * Set the active locale for the current JS context. Call once per entrypoint
 * (background, popup, options, each content script) after config is loaded, before
 * render. Idempotent — a second call just switches the language.
 */
export async function initI18n(uiLanguage: UiLanguage = "auto"): Promise<void> {
  activeLocale = resolveUiLocale(uiLanguage)
}

/** Switch the active UI language (synchronous — both dictionaries are bundled). */
export async function setUiLanguage(uiLanguage: UiLanguage): Promise<void> {
  activeLocale = resolveUiLocale(uiLanguage)
}

export const i18n: { t: FacadeT } = { t: rawT }
