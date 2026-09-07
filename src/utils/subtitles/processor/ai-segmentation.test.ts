import { describe, expect, it, vi } from "vitest"
import { MAX_CUE_DURATION_MS, MIN_CUE_DURATION_MS } from "@/utils/constants/subtitles"
import { sendMessage } from "@/utils/message"
import type { SubtitlesFragment } from "../types"
import {
  hasOversizedCue,
  parseSimplifiedVttToFragments,
  sanitizeSegmentedFragments,
  segmentChunkWithFallback,
} from "./ai-segmentation"

vi.mock("@/utils/message", () => ({ sendMessage: vi.fn() }))

const mockSendMessage = vi.mocked(sendMessage)

const WINDOW = { windowStartMs: 10_000, windowEndMs: 30_000 }

describe("sanitizeSegmentedFragments", () => {
  it("returns empty for a non-finite or degenerate window", () => {
    expect(
      sanitizeSegmentedFragments([{ text: "a", start: 0, end: 100 }], {
        windowStartMs: Number.NaN,
        windowEndMs: 1000,
      }),
    ).toHaveLength(0)
    expect(
      sanitizeSegmentedFragments([{ text: "a", start: 0, end: 100 }], {
        windowStartMs: 1000,
        windowEndMs: 1000,
      }),
    ).toHaveLength(0)
  })

  it("drops non-finite, inverted, empty, and out-of-window cues", () => {
    const fragments: SubtitlesFragment[] = [
      { text: "nan", start: Number.NaN, end: 20_000 },
      { text: "inverted", start: 20_000, end: 10_000 },
      { text: "   ", start: 10_000, end: 12_000 },
      { text: "before", start: 0, end: 10_000 },
      { text: "after", start: 30_000, end: 40_000 },
      { text: "kept", start: 10_000, end: 12_000 },
    ]
    const result = sanitizeSegmentedFragments(fragments, WINDOW)
    expect(result).toHaveLength(1)
    expect(result[0]!.text).toBe("kept")
  })

  it("clamps cues into the window", () => {
    const result = sanitizeSegmentedFragments(
      [{ text: "drifted", start: 5_000, end: 40_000 }],
      WINDOW,
    )
    expect(result[0]!.start).toBe(10_000)
    expect(result[0]!.end).toBe(30_000)
  })

  it("resolves overlaps by pushing the later cue forward and drops squeezed cues", () => {
    const result = sanitizeSegmentedFragments(
      [
        { text: "first", start: 10_000, end: 20_000 },
        { text: "second", start: 15_000, end: 25_000 },
        { text: "squeezed", start: 20_010, end: 21_000 },
      ],
      WINDOW,
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ text: "first", start: 10_000, end: 20_000 })
    expect(result[1]).toMatchObject({ text: "second", start: 20_000, end: 25_000 })
  })

  it("keeps a cue that only clips the window edge with a playable duration", () => {
    // Ends 50ms into the window: clamped to start at windowStart, end at start+MIN.
    const result = sanitizeSegmentedFragments(
      [{ text: "clipped", start: 9_000, end: 10_050 }],
      WINDOW,
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.start).toBe(10_000)
    expect(result[0]!.end).toBe(10_000 + MIN_CUE_DURATION_MS)
  })

  it("sorts output by start", () => {
    const result = sanitizeSegmentedFragments(
      [
        { text: "b", start: 15_000, end: 17_000 },
        { text: "a", start: 11_000, end: 13_000 },
      ],
      WINDOW,
    )
    expect(result.map((r) => r.text)).toEqual(["a", "b"])
  })
})

describe("hasOversizedCue", () => {
  it("trips on a cue longer than the maximum", () => {
    const fragments: SubtitlesFragment[] = [
      { text: "ok", start: 0, end: 5_000 },
      { text: "stuck", start: 5_000, end: 5_000 + MAX_CUE_DURATION_MS + 1 },
    ]
    expect(hasOversizedCue(fragments)).toBe(true)
  })

  it("accepts cues at or under the maximum", () => {
    const fragments: SubtitlesFragment[] = [{ text: "ok", start: 0, end: MAX_CUE_DURATION_MS }]
    expect(hasOversizedCue(fragments)).toBe(false)
    expect(hasOversizedCue([])).toBe(false)
  })
})

describe("parseSimplifiedVttToFragments", () => {
  it("parses plain millisecond cue lines", () => {
    const fragments = parseSimplifiedVttToFragments(
      "WEBVTT\n\n1000 --> 1500\nHello world.\n\n2000 --> 3500\nSecond line.",
    )
    expect(fragments).toEqual([
      { text: "Hello world.", start: 1000, end: 1500 },
      { text: "Second line.", start: 2000, end: 3500 },
    ])
  })

  it("parses standard VTT clock timestamps the model may slip into", () => {
    const fragments = parseSimplifiedVttToFragments(
      "WEBVTT\n\n00:01.000 --> 00:02.500\nHello world.\n\n00:00:03.000 --> 00:00:04.250\nSecond line.",
    )
    expect(fragments).toEqual([
      { text: "Hello world.", start: 1000, end: 2500 },
      { text: "Second line.", start: 3000, end: 4250 },
    ])
  })

  it("tolerates SRT-style comma milliseconds", () => {
    const fragments = parseSimplifiedVttToFragments("00:00:01,000 --> 00:00:02,000\nHi.")
    expect(fragments).toEqual([{ text: "Hi.", start: 1000, end: 2000 }])
  })

  it("still skips lines that are not cues", () => {
    const fragments = parseSimplifiedVttToFragments(
      "WEBVTT\n\nnot a cue --> line\n1000 --> 2000\nKept.",
    )
    expect(fragments).toEqual([{ text: "Kept.", start: 1000, end: 2000 }])
  })
})

describe("segmentChunkWithFallback", () => {
  const chunk: SubtitlesFragment[] = [
    { text: "hello world", start: 0, end: 3000 },
    { text: "second line", start: 3000, end: 6000 },
  ]

  it("returns optimized fragments when the model output is plausible", async () => {
    mockSendMessage.mockResolvedValueOnce(
      "WEBVTT\n\n0 --> 3000\nhello world.\n\n3000 --> 6000\nsecond line.",
    )
    const outcome = await segmentChunkWithFallback(chunk, { id: "p" } as any, "en")

    expect(outcome.status).toBe("ok")
    if (outcome.status === "ok") {
      expect(outcome.fragments.length).toBeGreaterThan(0)
      for (const fragment of outcome.fragments) {
        expect(fragment.end).toBeGreaterThan(fragment.start)
        expect(fragment.translation).toBeUndefined()
      }
    }
  })

  it("rejects a cue stretched across the whole window", async () => {
    mockSendMessage.mockResolvedValueOnce("WEBVTT\n\n0 --> 6000\nhello world second line.")
    const outcome = await segmentChunkWithFallback(
      [{ text: "hello world second line", start: 0, end: 20_000 }],
      { id: "p" } as any,
      "en",
    )
    expect(outcome.status).toBe("invalid")
  })

  it("rejects output that leaves a coverage hole in the source chunk", async () => {
    // Model dropped everything after the first cue; source spans 0..9000.
    mockSendMessage.mockResolvedValueOnce("WEBVTT\n\n0 --> 3000\nhello world.")
    const longChunk: SubtitlesFragment[] = [
      { text: "hello world", start: 0, end: 3000 },
      { text: "second line", start: 3000, end: 6000 },
      { text: "third line", start: 6000, end: 9000 },
    ]
    const outcome = await segmentChunkWithFallback(longChunk, { id: "p" } as any, "en")
    expect(outcome.status).toBe("invalid")
  })

  it("reports an API failure as error", async () => {
    mockSendMessage.mockRejectedValueOnce(new Error("network down"))
    const outcome = await segmentChunkWithFallback(chunk, { id: "p" } as any, "en")
    expect(outcome.status).toBe("error")
  })
})
