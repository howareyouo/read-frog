/**
 * Dependency-free deep merge, replacing `deepmerge-ts`.
 *
 * Semantics match `deepmerge-ts` defaults for JSON-shaped config data:
 * - plain objects are merged recursively into a new object (base is never mutated)
 * - arrays are concatenated (`mergeWithArrayOverwrite` takes the source instead)
 * - every other value (scalars, undefined, class instances) is overwritten by the source
 */

type PartialDeep<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: PartialDeep<T[K]> }
    : T

function isPlainObject(value: unknown): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value)
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (proto === Object.prototype || proto === null)
  )
}

type ArrayMergeMode = "concat" | "replace"

function mergeDeep<T>(base: T, source: unknown, arrayMode: ArrayMergeMode): T {
  if (isPlainObject(base) && isPlainObject(source)) {
    const result: Record<string, unknown> = { ...base }
    for (const [key, sourceValue] of Object.entries(source)) {
      result[key] = mergeDeep(result[key], sourceValue, arrayMode)
    }
    return result as T
  }
  if (Array.isArray(base) && Array.isArray(source)) {
    return (arrayMode === "concat" ? [...base, ...source] : source) as T
  }
  return source as T
}

export function deepmerge<T>(base: T, source: PartialDeep<T>): T {
  return mergeDeep(base, source, "concat")
}

export function mergeWithArrayOverwrite<T>(base: T, source: PartialDeep<T>): T {
  return mergeDeep(base, source, "replace")
}
