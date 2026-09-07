import { describe, expect, it } from "vitest"
import { MAX_CHARS_CJK, MAX_WORDS } from "@/utils/constants/subtitles"
import type { SubtitlesFragment } from "../types"
import { optimizeSubtitles, splitOversizedFragment } from "./optimizer"

function englishWords(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(" ")
}

describe("splitOversizedFragment", () => {
  it("passes through a fragment that fits the budget", () => {
    const fragment: SubtitlesFragment = { text: "short line", start: 1000, end: 4000 }
    const result = splitOversizedFragment(fragment, "en")
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ text: "short line", start: 1000, end: 4000 })
  })

  it("splits an English fragment by words and spreads time proportionally", () => {
    // 40 words > MAX_WORDS (15) → runs of 15 / 15 / 10.
    const fragment: SubtitlesFragment = { text: englishWords(40), start: 0, end: 40_000 }
    const result = splitOversizedFragment(fragment, "en")

    expect(result.length).toBe(3)
    for (const part of result) {
      expect(part.text.split(/\s+/).length).toBeLessThanOrEqual(MAX_WORDS)
    }

    // Time is split across the same span, monotonically, and covers it.
    expect(result[0]!.start).toBe(0)
    expect(result.at(-1)!.end).toBe(40_000)
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.start).toBe(result[i - 1]!.end)
    }
    for (const part of result) {
      expect(part.end).toBeGreaterThan(part.start)
    }

    // Proportional: the last run (10/40 of the words) gets roughly 1/4 of the span.
    const last = result.at(-1)!
    expect(last.end - last.start).toBeCloseTo(10_000, -2)
  })

  it("splits a CJK fragment by characters", () => {
    const text = "字".repeat(75) // 75 chars > MAX_CHARS_CJK (30)
    const fragment: SubtitlesFragment = { text, start: 1000, end: 31_000 }
    const result = splitOversizedFragment(fragment, "zh")

    expect(result.length).toBe(3)
    for (const part of result) {
      expect([...part.text].length).toBeLessThanOrEqual(MAX_CHARS_CJK)
    }
    expect([...result.map((r) => r.text).join("")]).toHaveLength(75)
  })

  it("gives a collapsed span a minimum duration per cue", () => {
    const fragment: SubtitlesFragment = { text: englishWords(30), start: 5000, end: 5000 }
    const result = splitOversizedFragment(fragment, "en")

    expect(result.length).toBe(2)
    for (const part of result) {
      expect(part.end).toBeGreaterThanOrEqual(part.start + 120)
    }
  })

  it("drops fragments that are empty after cleaning", () => {
    expect(splitOversizedFragment({ text: "   ", start: 0, end: 1000 }, "en")).toHaveLength(0)
  })
})

describe("optimizeSubtitles with oversized input", () => {
  it("breaks a single 60s wall-of-text cue into per-budget cues", () => {
    const input: SubtitlesFragment[] = [{ text: englishWords(40), start: 1000, end: 61_000 }]
    const result = optimizeSubtitles(input, "en")

    expect(result.length).toBeGreaterThan(1)
    for (const fragment of result) {
      expect(fragment.text.split(/\s+/).length).toBeLessThanOrEqual(MAX_WORDS)
      expect(fragment.end).toBeGreaterThan(fragment.start)
    }
  })

  it("does not merge cues that already fit the budget", () => {
    const input: SubtitlesFragment[] = [
      { text: "first sentence.", start: 0, end: 2000 },
      { text: "second sentence.", start: 5000, end: 8000 },
    ]
    const result = optimizeSubtitles(input, "en")
    expect(result.map((r) => r.text)).toEqual(["first sentence.", "second sentence."])
  })
})

describe("splitOversizedFragment with an unbreakable token", () => {
  it("character-splits a whitespace-free token past the visual line limit", () => {
    // ~170 chars of URL: word-count length is 1, so only the char-based path sees it.
    const token = "https://example.com/" + "a".repeat(150)
    const fragment: SubtitlesFragment = { text: token, start: 1000, end: 19_000 }

    const result = splitOversizedFragment(fragment, "en")

    expect(result.length).toBeGreaterThan(1)
    for (const part of result) {
      expect(part.text.length).toBeLessThanOrEqual(MAX_WORDS)
      expect(part.end).toBeGreaterThan(part.start)
    }
    expect(result.map((r) => r.text).join("")).toBe(token)
    expect(result[0]!.start).toBe(1000)
    expect(result.at(-1)!.end).toBe(19_000)
  })

  it("keeps a lone token under the visual line limit whole", () => {
    const token = "https://example.com/short"
    const fragment: SubtitlesFragment = { text: token, start: 1000, end: 19_000 }

    const result = splitOversizedFragment(fragment, "en")
    expect(result).toHaveLength(1)
    expect(result[0]!.text).toBe(token)
  })

  it("splits multi-word text by words without cutting inside words", () => {
    const longWord = "x".repeat(24)
    const words = [longWord, ...Array.from({ length: 20 }, (_, i) => `w${i}`)]
    const text = words.join(" ")
    const fragment: SubtitlesFragment = { text, start: 0, end: 21_000 }

    const result = splitOversizedFragment(fragment, "en")

    expect(result.length).toBeGreaterThan(1)
    expect(result.flatMap((r) => r.text.split(/\s+/)).filter(Boolean)).toEqual(words)
  })
})
