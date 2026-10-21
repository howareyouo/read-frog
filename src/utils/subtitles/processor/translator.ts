import { LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import type { Config } from "@/types/config/config"
import type { SubtitlePromptContext } from "@/types/content"
import { getLocalConfig } from "@/utils/config/storage"
import { TRANSLATE_LEAD_MS } from "@/utils/constants/subtitles"
import { cleanText } from "@/utils/content/utils"
import { Sha256Hex } from "@/utils/hash"
import { prepareTranslationText } from "@/utils/host/translate/text-preparation"
import { normalizePromptContextValue } from "@/utils/host/translate/translate-text"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { getSubtitlesTranslatePrompt } from "@/utils/prompts/subtitles"
import {
  hasUsableFeatureProvider,
  hasUsableLLMFeatureProvider,
  resolveRotatingProviderRefForFeature,
} from "@/utils/providers/feature-provider-resolver"
import type { SerializableProviderRef } from "@/utils/providers/provider-ref"
import {
  canProviderRefGenerateText,
  getProviderCacheIdentity,
  serializeProviderRef,
} from "@/utils/providers/provider-ref"
import { resolveProviderRefForCapability } from "@/utils/providers/provider-registry"
import type { SubtitlesFragment } from "../types"

export interface SubtitlesVideoContext {
  videoTitle: string
  videoDescription?: string | null
  subtitlesTextContent: string
  summary?: string | null
}

export function buildSubtitlesSummaryContextHash(
  videoContext: Pick<SubtitlesVideoContext, "subtitlesTextContent">,
  providerRef?: SerializableProviderRef,
): string | undefined {
  const preparedText = cleanText(videoContext.subtitlesTextContent)
  if (!preparedText) {
    return undefined
  }

  const textHash = Sha256Hex(preparedText)
  return Sha256Hex(textHash, providerRef ? getProviderCacheIdentity(providerRef) : "")
}

function normalizeSubtitlePromptContext(
  videoContext: SubtitlesVideoContext,
): SubtitlePromptContext {
  return {
    webTitle: normalizePromptContextValue(videoContext.videoTitle),
    webDescription: normalizePromptContextValue(videoContext.videoDescription),
    videoSummary: normalizePromptContextValue(videoContext.summary),
  }
}

async function buildSubtitleHashComponents(
  text: string,
  isLLM: boolean,
  partialLangConfig: {
    sourceCode: Config["language"]["sourceCode"]
    targetCode: Config["language"]["targetCode"]
  },
  enableAIContentAware: boolean,
  subtitlePromptContext: SubtitlePromptContext,
  subtitlesTextContent: string,
): Promise<string[]> {
  const preparedText = prepareTranslationText(text)
  const normalizedSubtitlesTextContent = normalizePromptContextValue(subtitlesTextContent)
  // Deliberately NOT a component: the provider identity. Batches are composed
  // provider-agnostically (the provider is picked once per batch at flush
  // time), so keys must not depend on which provider ends up serving the cue —
  // that also lets translations stay shared across rotated providers.
  const hashComponents = [preparedText, partialLangConfig.sourceCode, partialLangConfig.targetCode]

  // Pure translate providers take no prompt; local LLMs do, so they contribute
  // the prompt to the cache key.
  if (!isLLM) {
    return hashComponents
  }

  const targetLangName = LANG_CODE_TO_EN_NAME[partialLangConfig.targetCode]
  const promptContext = enableAIContentAware
    ? subtitlePromptContext
    : { ...subtitlePromptContext, videoSummary: undefined }
  const { systemPrompt, prompt } = await getSubtitlesTranslatePrompt(targetLangName, preparedText, {
    isBatch: true,
    context: promptContext,
  })
  hashComponents.push(systemPrompt, prompt)
  hashComponents.push(
    enableAIContentAware ? "enableAIContentAware=true" : "enableAIContentAware=false",
  )

  if (subtitlePromptContext.webTitle) {
    hashComponents.push(`webTitle:${subtitlePromptContext.webTitle}`)
  }
  if (subtitlePromptContext.webDescription) {
    hashComponents.push(`webDescription:${subtitlePromptContext.webDescription}`)
  }
  if (enableAIContentAware && normalizedSubtitlesTextContent) {
    hashComponents.push(`subtitlesTextContent:${normalizedSubtitlesTextContent.slice(0, 1000)}`)
  }

  // Deliberately NOT in the key: the video summary. It is derived from the
  // transcript, whose first 1000 characters already contribute above, and it
  // only exists a few seconds into playback. Keying on it meant every cue
  // translated before the summary landed was re-translated once it did — the
  // whole opening of the video missed the cache exactly once, at the moment
  // the user was waiting on it.
  return hashComponents
}

/** Cache key for one cue: everything that can change its translation. */
async function buildSubtitleHash(
  text: string,
  isLLM: boolean,
  partialLangConfig: {
    sourceCode: Config["language"]["sourceCode"]
    targetCode: Config["language"]["targetCode"]
  },
  enableAIContentAware: boolean,
  subtitlePromptContext: SubtitlePromptContext,
  subtitlesTextContent: string,
): Promise<string> {
  const hashComponents = await buildSubtitleHashComponents(
    text,
    isLLM,
    partialLangConfig,
    enableAIContentAware,
    subtitlePromptContext,
    subtitlesTextContent,
  )
  return Sha256Hex(...hashComponents)
}

/**
 * Resolve the subtitles provider into a transportable ref, serialized once per
 * run. Null means no enabled provider can run the feature; callers degrade to
 * untranslated output.
 */
export async function resolveSubtitlesProviderRef(
  config: Config,
): Promise<SerializableProviderRef | null> {
  const resolved = resolveProviderRefForCapability(
    "videoSubtitles",
    config.providersConfig,
    config.videoSubtitles.providers[0] ?? "",
  )
  if (!resolved) {
    return null
  }
  return serializeProviderRef(resolved.config)
}

/**
 * The next AI-segmentation provider in the feature's rotation.
 *
 * Callers used to hand segmentation the primary ref above, which reads
 * `videoSubtitles.providers[0]` — so every chunk of every video was cut by the
 * one interface at the top of the list while the other keys sat idle, and a
 * pure-translate primary (Microsoft / Google / DeepLX) was handed a prompt it
 * cannot answer. Segmentation is a generation, so it takes the same selection
 * the translation batch queue uses: rotate over every enabled provider, keep
 * only the ones that can take a prompt, and route around the ones cooling down
 * from a 429 or a credential rejection.
 *
 * Resolved per chunk, not per session — a session-long ref is a session-long
 * pin on whichever provider the rotation happened to land on first.
 *
 * Null means nothing can serve it right now (no LLM selected, or every
 * candidate is cooling); callers fall back to rule-based segmentation.
 */
export function resolveSegmentationProviderRef(config: Config): SerializableProviderRef | null {
  const resolved = resolveRotatingProviderRefForFeature("videoSubtitles", config, {
    requireLLM: true,
  })
  if (!resolved) {
    return null
  }
  return serializeProviderRef(resolved.config)
}

export async function fetchSubtitlesSummary(
  videoContext: SubtitlesVideoContext,
  configOverride?: Config,
): Promise<string | null> {
  const config = configOverride ?? (await getLocalConfig())
  if (!config?.pageTranslation.enableAIContentAware) {
    return null
  }

  const providerRef = await resolveSubtitlesProviderRef(config)
  // A summary is a generation, but the subtitles provider list is gated on the
  // wider translate capability — so the default Microsoft provider resolves
  // here perfectly well and then cannot be prompted. Bail before the message:
  // the background admits it to the queue, where it throws and burns its
  // retries at the start of every video.
  if (!providerRef || !canProviderRefGenerateText(providerRef)) {
    return null
  }

  if (!videoContext.videoTitle || !videoContext.subtitlesTextContent) {
    return null
  }

  return await sendMessage("getSubtitlesSummary", {
    videoTitle: videoContext.videoTitle,
    subtitlesContext: videoContext.subtitlesTextContent,
    providerRef,
  })
}

export async function translateSubtitles(
  fragments: SubtitlesFragment[],
  videoContext: SubtitlesVideoContext,
  configOverride?: Config | null,
  requestedTimeMs?: number,
  onFragmentSettled?: (fragment: SubtitlesFragment) => void,
): Promise<SubtitlesFragment[]> {
  const config = configOverride ?? (await getLocalConfig())
  if (!config) {
    return fragments.map((f) => ({ ...f, translation: "" }))
  }

  // No usable provider for the feature (disabled or capability mismatch).
  // Thrown, not silently blanked: an empty translation is indistinguishable
  // from "original only" and nothing else in the pipeline surfaces this state.
  if (!hasUsableFeatureProvider(config, "videoSubtitles")) {
    throw new Error(i18n.t("subtitles.errors.noProviderSelected"))
  }

  const langConfig = config.language
  const enableAIContentAware = config.pageTranslation.enableAIContentAware
  const subtitlePromptContext = normalizeSubtitlePromptContext(videoContext)

  // ONE provider-less message for the whole window. The background composes
  // every cue into provider-agnostic batches and picks the provider once per
  // batch at flush time — resolving a provider here (per window) put each
  // window's cues on a different provider, and the batch key followed the
  // provider, so steady-state windows of 1-2 cues never composed into batches.
  const useLLMHash = hasUsableLLMFeatureProvider(config, "videoSubtitles")

  const hashes = await Promise.all(
    fragments.map((fragment) =>
      buildSubtitleHash(
        fragment.text,
        useLLMHash,
        { sourceCode: langConfig.sourceCode, targetCode: langConfig.targetCode },
        enableAIContentAware,
        subtitlePromptContext,
        videoContext.subtitlesTextContent,
      ),
    ),
  )

  // One message PER CUE, not per window. A look-ahead window spans minutes,
  // and the background holds below-min batches until their earliest cue nears
  // playback (dueAt). A single window message would resolve only when its
  // FARTHEST held cue lands — pinning every already-finished near cue (the one
  // on screen) behind it, so the player sat on "translating" while the
  // provider responses had long returned. Per-cue messages resolve each cue
  // when its own batch flushes; composition itself is untouched (the
  // background BatchQueue still merges everything into full batches), and the
  // extra cost is one round trip + one cache read per newly translated cue.
  //
  // `onFragmentSettled` fires the moment a cue's own message lands, so the
  // coordinator can publish the near cues the player is about to read without
  // waiting for the far, deliberately-held prefetch cues in the same window to
  // also return. Awaiting the whole window (Promise.allSettled below) re-couples
  // them exactly like the old single window message did — near cue pinned behind
  // its farthest sibling — which is the "loading" the look-ahead was meant to
  // prevent. The awaited result is still returned for the batch-level error gate.
  const results = await Promise.allSettled(
    fragments.map(async (fragment, index) => {
      const value = await sendMessage("enqueueSubtitlesTranslation", {
        text: fragment.text,
        hash: hashes[index]!,
        // With a playback position the background can hold below-min
        // batches until their earliest cue nears playback; without one
        // (full-video download) the queue falls back to batchDelay. The
        // deadline is pulled TRANSLATE_LEAD_MS ahead of the cue's
        // playback time, so the request starts that much earlier and the
        // translation lands before the line is read instead of after.
        startsInMs:
          requestedTimeMs === undefined
            ? undefined
            : fragment.start - requestedTimeMs - TRANSLATE_LEAD_MS,
        langConfig,
        scheduleAt: Date.now(),
        webTitle: subtitlePromptContext.webTitle,
        webDescription: subtitlePromptContext.webDescription,
        summary: enableAIContentAware ? subtitlePromptContext.videoSummary : undefined,
      })
      // An empty slot is a failed cue: leave it to the whole-window error gate
      // rather than publishing a blank over the source line.
      if (value.translation && onFragmentSettled) {
        onFragmentSettled({ ...fragment, translation: value.translation })
      }
      return value
    }),
  )

  let firstErrorMessage: string | undefined
  let anySucceeded = false
  const translated = fragments.map((fragment, index) => {
    const result = results[index]
    if (result?.status === "fulfilled") {
      const { translation, errorMessage } = result.value
      if (translation !== null) {
        anySucceeded = true
        return { ...fragment, translation }
      }
      firstErrorMessage ??= errorMessage
    } else if (result?.status === "rejected") {
      const reason = result.reason
      firstErrorMessage ??= reason instanceof Error ? reason.message : String(reason)
    }
    // This cue failed; the window must not blank its siblings.
    return { ...fragment, translation: "" }
  })

  if (fragments.length > 0 && !anySucceeded) {
    throw new Error(firstErrorMessage ?? i18n.t("subtitles.errors.aiNoResponse"))
  }

  return translated
}
