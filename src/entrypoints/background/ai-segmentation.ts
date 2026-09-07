import { db } from "@/utils/db/dexie/db"
import { Sha256Hex } from "@/utils/hash"
import { logger } from "@/utils/logger"
import { getSubtitlesSegmentationPrompt } from "@/utils/prompts/subtitles-segmentation"
import type { SerializableProviderRef } from "@/utils/providers/provider-ref"
import { RequestQueue } from "@/utils/request/request-queue"
import { parseSimplifiedVttToFragments } from "@/utils/subtitles/processor/ai-segmentation"
import { generateTextForProviderRef } from "./background-stream"

/**
 * AI segmentation used to call the provider directly, with no rate limiting —
 * a burst of chunks (one per video, fired in parallel) could saturate the
 * shared LLM and starve live subtitle translation of its own request-queue
 * tokens. This is its OWN token bucket: segmentation and translation can now
 * each run at full speed without blocking the other at the extension level
 * (P8). Rate/capacity are deliberately modest so a backlog of segmentation
 * never hogs every provider concurrent slot.
 */
let segmentationQueue: RequestQueue | null = null
function getSegmentationQueue(): RequestQueue {
  if (!segmentationQueue) {
    segmentationQueue = new RequestQueue({
      rate: 4,
      capacity: 8,
      timeoutMs: 60_000,
      maxRetries: 1,
      baseRetryDelayMs: 1_000,
    })
  }
  return segmentationQueue
}

const VTT_CODE_BLOCK_RE = /```vtt\n?/g
const CODE_BLOCK_RE = /```\n?/g
const THINK_TAG_RE = /<\/think>([\s\S]*)/

interface AiSegmentSubtitlesData {
  jsonContent: string
  providerRef: SerializableProviderRef
}

/**
 * Clean VTT response from AI (remove markdown code blocks, ensure WEBVTT header)
 */
function cleanVttResponse(text: string): string {
  let cleaned = text.trim()

  // Remove markdown code blocks
  cleaned = cleaned.replace(VTT_CODE_BLOCK_RE, "").replace(CODE_BLOCK_RE, "")

  // Handle thinking model output (strip <think> tags)
  const [, afterThink = cleaned] = cleaned.match(THINK_TAG_RE) || []
  cleaned = afterThink.trim()

  // Ensure starts with WEBVTT
  if (!cleaned.toUpperCase().startsWith("WEBVTT")) {
    cleaned = `WEBVTT\n\n${cleaned}`
  }

  return cleaned
}

/**
 * Run AI segmentation on JSON subtitle content
 */
export async function runAiSegmentSubtitles(data: AiSegmentSubtitlesData): Promise<string> {
  const { jsonContent, providerRef } = data

  if (!jsonContent) {
    throw new Error("jsonContent is required for AI segmentation")
  }

  // The ref is resolved on the content side, where a session already holds one.
  //
  // Deliberately NOT in the key: the provider identity. Segmentation rotates
  // across every enabled LLM provider, one per chunk, so keying on the provider
  // meant a chunk was only ever a cache hit when the rotation happened to land
  // on the provider that cut it last time — a second viewing of the same video
  // degraded to roughly a 1-in-N hit rate. Any model's cut is equally usable:
  // the sanity gates below (and the ones in segmentChunkWithFallback) run on
  // the result regardless of who produced it.
  const cacheKey = Sha256Hex(jsonContent)
  const cached = await db.aiSegmentationCache.get(cacheKey)
  if (cached) {
    if (parseSimplifiedVttToFragments(cached.result).length > 0) {
      logger.info("[Background] AI subtitle segmentation cache hit")
      return cached.result
    }
    // Entry written before results were parse-checked; drop it and regenerate
    // instead of serving the same unusable VTT on every attempt.
    await db.aiSegmentationCache.delete(cacheKey)
  }

  const { systemPrompt, prompt } = getSubtitlesSegmentationPrompt(jsonContent)

  try {
    const segmentedVtt = await getSegmentationQueue().enqueue(
      (signal) =>
        generateTextForProviderRef(
          {
            providerRef,
            instructions: systemPrompt,
            prompt,
          },
          { signal },
        ),
      Date.now(),
      cacheKey,
    )

    const result = cleanVttResponse(segmentedVtt)

    // Parse-check before caching: a cached result that yields no cues would be
    // served on every later attempt for this chunk, pinning the failure until
    // the provider's cache identity changes.
    if (parseSimplifiedVttToFragments(result).length === 0) {
      throw new Error("AI segmentation returned an unparseable result")
    }

    await db.aiSegmentationCache.put({
      key: cacheKey,
      result,
      createdAt: new Date(),
    })

    logger.info("[Background] AI subtitle segmentation completed")
    return result
  } catch (error) {
    logger.error("[Background] AI subtitle segmentation failed:", error)
    throw error
  }
}
