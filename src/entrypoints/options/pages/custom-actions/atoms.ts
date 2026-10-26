import { configFieldsAtomMap } from "@/utils/atoms/config"
import { createSelectedEntityAtom } from "@/utils/atoms/selected-entity"
import { BUILT_IN_DICTIONARY_ACTION_ID } from "@/utils/constants/custom-action"

export const selectedCustomActionIdAtom = createSelectedEntityAtom((get, selected) => {
  const customActions = get(configFieldsAtomMap.selectionToolbar).customActions

  if (
    selected === BUILT_IN_DICTIONARY_ACTION_ID ||
    (selected && customActions.some((action) => action.id === selected))
  ) {
    return selected
  }

  return BUILT_IN_DICTIONARY_ACTION_ID
})
