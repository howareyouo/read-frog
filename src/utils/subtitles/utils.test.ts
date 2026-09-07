import { describe, expect, it } from "vitest"
import type { SubtitlesFragment } from "./types"
import {
  findActiveCue,
  findActiveCueIndex,
  lowerBoundByStart,
  mergeSortedByStart,
  replaceFragmentWindow,
} from "./utils"

describe("findActiveCue", () => {
  it("returns null when no cue covers the time", () => {
    const cues = [
      { text: "a", start: 0, end: 1000 },
      { text: "b", start: 2000, end: 3000 },
    ]
    expect(findActiveCue(cues, 1500)).toBeNull()
    expect(findActiveCue(cues, -1)).toBeNull()
  })

  it("returns the cue covering the time", () => {
    const cues = [
      { text: "a", start: 0, end: 1000 },
      { text: "b", start: 2000, end: 3000 },
    ]
    expect(findActiveCue(cues, 500)?.text).toBe("a")
    expect(findActiveCue(cues, 2500)?.text).toBe("b")
  })

  it("treats start as inclusive and end as exclusive", () => {
    const cues = [{ text: "a", start: 1000, end: 2000 }]
    expect(findActiveCue(cues, 1000)?.text).toBe("a")
    expect(findActiveCue(cues, 2000)).toBeNull()
  })

  it("picks the latest-starting cue when cues overlap", () => {
    const cues = [
      { text: "stale", start: 0, end: 5000 },
      { text: "fresh", start: 2000, end: 4000 },
    ]
    // 2500 is covered by both; the line the viewer expects is the one that started later.
    expect(findActiveCue(cues, 2500)?.text).toBe("fresh")
  })

  it("returns the latest-starting cover even when listed first", () => {
    const cues = [
      { text: "fresh", start: 2000, end: 4000 },
      { text: "stale", start: 0, end: 5000 },
    ]
    expect(findActiveCue(cues, 2500)?.text).toBe("fresh")
  })
})

describe("findActiveCueIndex", () => {
  it("returns -1 when nothing covers the time", () => {
    const cues = [{ text: "a", start: 0, end: 1000 }]
    expect(findActiveCueIndex(cues, 1000)).toBe(-1)
    expect(findActiveCueIndex([], 0)).toBe(-1)
  })

  it("matches findActiveCue, including the overlap rule", () => {
    const cues = [
      { text: "stale", start: 0, end: 5000 },
      { text: "fresh", start: 2000, end: 4000 },
      { text: "later", start: 6000, end: 7000 },
    ]
    expect(findActiveCueIndex(cues, 2500)).toBe(1)
    expect(findActiveCueIndex(cues, 6500)).toBe(2)
    expect(findActiveCueIndex(cues, 5500)).toBe(-1)

    const active = findActiveCue(cues, 2500)
    expect(active).toBe(cues[findActiveCueIndex(cues, 2500)])
  })
})

describe("lowerBoundByStart", () => {
  const cues: SubtitlesFragment[] = [
    { text: "a", start: 1000, end: 2000 },
    { text: "b", start: 3000, end: 4000 },
    { text: "c", start: 3000, end: 5000 },
    { text: "d", start: 7000, end: 8000 },
  ]

  it("returns the first index at or after the bound", () => {
    expect(lowerBoundByStart(cues, 0)).toBe(0)
    expect(lowerBoundByStart(cues, 1500)).toBe(1)
    expect(lowerBoundByStart(cues, 3000)).toBe(1)
    expect(lowerBoundByStart(cues, 3001)).toBe(3)
    expect(lowerBoundByStart(cues, 8000)).toBe(4)
  })

  it("handles empty lists", () => {
    expect(lowerBoundByStart([], 1000)).toBe(0)
  })
})

describe("mergeSortedByStart", () => {
  it("interleaves two sorted lists", () => {
    const left: SubtitlesFragment[] = [
      { text: "a", start: 0, end: 500 },
      { text: "c", start: 2000, end: 2500 },
    ]
    const right: SubtitlesFragment[] = [
      { text: "b", start: 1000, end: 1500 },
      { text: "d", start: 3000, end: 3500 },
    ]
    expect(mergeSortedByStart(left, right).map((f) => f.text)).toEqual(["a", "b", "c", "d"])
  })

  it("keeps left-list cues first on equal starts", () => {
    const left: SubtitlesFragment[] = [{ text: "left", start: 1000, end: 2000 }]
    const right: SubtitlesFragment[] = [{ text: "right", start: 1000, end: 2000 }]
    expect(mergeSortedByStart(left, right)[0]!.text).toBe("left")
  })

  it("accepts empty inputs", () => {
    const one: SubtitlesFragment[] = [{ text: "a", start: 0, end: 100 }]
    expect(mergeSortedByStart([], one)).toHaveLength(1)
    expect(mergeSortedByStart(one, [])).toHaveLength(1)
  })
})

describe("replaceFragmentWindow", () => {
  it("drops cues inside the window and keeps outside ones", () => {
    const existing: SubtitlesFragment[] = [
      { text: "before", start: 0, end: 1000 },
      { text: "inside", start: 2000, end: 3000 },
      { text: "after", start: 5000, end: 6000 },
    ]
    const next: SubtitlesFragment[] = [{ text: "new", start: 2000, end: 3000 }]

    const result = replaceFragmentWindow(existing, 2000, 4000, next)
    expect(result.map((f) => f.text)).toEqual(["before", "new", "after"])
  })

  it("drops cues that merely overlap the window, not just start inside it", () => {
    const existing: SubtitlesFragment[] = [
      { text: "straddling", start: 1000, end: 3500 },
      { text: "after", start: 5000, end: 6000 },
    ]
    const result = replaceFragmentWindow(existing, 3000, 4000, [])
    expect(result.map((f) => f.text)).toEqual(["after"])
  })

  it("treats the window as half-open", () => {
    const existing: SubtitlesFragment[] = [
      { text: "ends-at-start", start: 0, end: 1000 },
      { text: "starts-at-end", start: 3000, end: 4000 },
    ]
    const result = replaceFragmentWindow(existing, 1000, 3000, [])
    expect(result).toHaveLength(2)
  })

  it("inserts next fragments in sorted position among outside cues", () => {
    const existing: SubtitlesFragment[] = [
      { text: "late", start: 5000, end: 6000 },
      { text: "later", start: 8000, end: 9000 },
    ]
    const next: SubtitlesFragment[] = [
      { text: "first", start: 1000, end: 2000 },
      { text: "second", start: 3000, end: 4000 },
    ]
    const result = replaceFragmentWindow(existing, 1000, 5000, next)
    expect(result.map((f) => f.text)).toEqual(["first", "second", "late", "later"])
  })
})
