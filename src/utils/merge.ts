import { deepmergeCustom } from "deepmerge-ts"

export const mergeWithArrayOverwrite = deepmergeCustom({
  // Use the last (source) array
  mergeArrays: (values) => values[values.length - 1],
})
