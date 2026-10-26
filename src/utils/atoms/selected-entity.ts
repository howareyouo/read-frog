import type { Getter } from "jotai"
import { atom } from "jotai"

/**
 * A "which entity is selected" atom for entity lists (providers, custom
 * actions): the explicit selection lives in a private atom and the public read
 * delegates to `resolveSelected` so each list can decide when to fall back to
 * a default (first item, a built-in sentinel...) when nothing valid is chosen.
 */
export function createSelectedEntityAtom(
  resolveSelected: (get: Getter, selected: string | undefined) => string | undefined,
) {
  const internalSelectedIdAtom = atom<string | undefined>(undefined)
  return atom(
    (get) => resolveSelected(get, get(internalSelectedIdAtom)),
    (_get, set, newValue: string | undefined) => {
      set(internalSelectedIdAtom, newValue)
    },
  )
}
