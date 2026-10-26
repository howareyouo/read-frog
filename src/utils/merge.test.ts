import { describe, expect, it } from "vitest"
import { deepmerge, mergeWithArrayOverwrite } from "./merge"

describe("deepmerge", () => {
  it("does not throw when the source contains a null value", () => {
    const base = { a: { b: 1, customCSS: null as string | null } }

    const result = deepmerge(base, { a: { customCSS: null } })

    expect(result).toEqual({ a: { b: 1, customCSS: null } })
  })

  it("does not throw when the base contains a null value", () => {
    const base = { style: { customCSS: null as string | null, main: { color: "#FFFFFF" } } }

    const result = deepmerge(base, { style: { main: { color: "#00FF00" } } })

    expect(result).toEqual({ style: { customCSS: null, main: { color: "#00FF00" } } })
  })

  it("handles a full-object patch of a config that contains null fields", () => {
    const base = {
      enabled: true,
      style: { customCSS: null as string | null, main: { color: "#FFFFFF", fontSize: 20 } },
    }
    const patch = {
      enabled: true,
      style: { customCSS: null as string | null, main: { color: "#FF0000", fontSize: 24 } },
    }

    const result = mergeWithArrayOverwrite(base, patch)

    expect(result.style.main).toEqual({ color: "#FF0000", fontSize: 24 })
  })

  it("merges nested plain objects without mutating the base", () => {
    const base = { a: { b: 1, c: 2 } }

    const result = deepmerge(base, { a: { c: 3 } })

    expect(result).toEqual({ a: { b: 1, c: 3 } })
    expect(base).toEqual({ a: { b: 1, c: 2 } })
  })

  it("overwrites scalars with the source value", () => {
    const result = deepmerge({ a: 1, b: "x" }, { a: 2 })

    expect(result).toEqual({ a: 2, b: "x" })
  })

  it("concatenates arrays", () => {
    const result = deepmerge({ list: [1, 2] }, { list: [3] })

    expect(result).toEqual({ list: [1, 2, 3] })
  })
})

describe("mergeWithArrayOverwrite", () => {
  it("replaces arrays instead of concatenating them", () => {
    const result = mergeWithArrayOverwrite({ list: [1, 2] }, { list: [3] })

    expect(result).toEqual({ list: [3] })
  })
})
