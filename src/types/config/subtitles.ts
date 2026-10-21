import { z } from "zod"
import { BUILT_IN_SUBTITLE_TRANSLATE_PROMPT_IDS } from "@/utils/constants/prompt"
import {
  DEFAULT_TRANSLATE_LOOK_AHEAD_SECONDS,
  MAX_BACKGROUND_OPACITY,
  MAX_FONT_SCALE,
  MAX_FONT_WEIGHT,
  MAX_TRANSLATE_LOOK_AHEAD_SECONDS,
  MIN_BACKGROUND_OPACITY,
  MIN_FONT_SCALE,
  MIN_FONT_WEIGHT,
  MIN_TRANSLATE_LOOK_AHEAD_SECONDS,
} from "@/utils/constants/subtitles"
import {
  batchQueueConfigSchema,
  createCustomPromptsConfigSchema,
  MAX_CUSTOM_CSS_LENGTH,
  pageTranslationShortcutSchema,
  requestQueueConfigSchema,
} from "./translate"

export const subtitleCustomPromptsConfigSchema = createCustomPromptsConfigSchema(
  BUILT_IN_SUBTITLE_TRANSLATE_PROMPT_IDS,
)

export const subtitlesDisplayModeSchema = z.enum(["bilingual", "originalOnly", "translationOnly"])
export const subtitlesTranslationPositionSchema = z.enum(["above", "below"])
export const subtitlesFontFamilySchema = z.enum(["system", "roboto", "noto-sans", "noto-serif"])

export const subtitleTextStyleSchema = z.object({
  fontFamily: subtitlesFontFamilySchema,
  fontScale: z.number().min(MIN_FONT_SCALE).max(MAX_FONT_SCALE),
  color: z.string(),
  fontWeight: z.number().min(MIN_FONT_WEIGHT).max(MAX_FONT_WEIGHT),
})

export const subtitleContainerStyleSchema = z.object({
  backgroundOpacity: z.number().min(MIN_BACKGROUND_OPACITY).max(MAX_BACKGROUND_OPACITY),
})

export const subtitlesStyleSchema = z.object({
  displayMode: subtitlesDisplayModeSchema,
  translationPosition: subtitlesTranslationPositionSchema,
  main: subtitleTextStyleSchema,
  translation: subtitleTextStyleSchema,
  container: subtitleContainerStyleSchema,
  /** Extra CSS for the subtitle lines, on top of the picked fonts and colours. `null` is off. */
  customCSS: z.string().max(MAX_CUSTOM_CSS_LENGTH, "Custom CSS cannot exceed 8KB").nullable(),
})

export const subtitlePositionSchema = z.object({
  percent: z.number().min(0).max(100),
  anchor: z.enum(["top", "bottom"]),
})

export const videoSubtitlesSchema = z.object({
  enabled: z.boolean(),
  autoStart: z.boolean(),
  toggleShortcut: pageTranslationShortcutSchema,
  providers: z.array(z.string()).default([]),
  style: subtitlesStyleSchema,
  aiSegmentation: z.boolean(),
  requestQueueConfig: requestQueueConfigSchema,
  batchQueueConfig: batchQueueConfigSchema,
  // How far ahead of the playback position subtitles are translated, in seconds.
  // Defaulted so configs stored before this field still parse. The window's
  // near edge is a separate fixed lead (TRANSLATE_LEAD_MS): cues closer than
  // that to the playhead are skipped because they cannot translate in time.
  translateLookAheadSeconds: z
    .number()
    .min(MIN_TRANSLATE_LOOK_AHEAD_SECONDS)
    .max(MAX_TRANSLATE_LOOK_AHEAD_SECONDS)
    .default(DEFAULT_TRANSLATE_LOOK_AHEAD_SECONDS),
  customPromptsConfig: subtitleCustomPromptsConfigSchema,
  position: subtitlePositionSchema,
})

export type SubtitlesDisplayMode = z.infer<typeof subtitlesDisplayModeSchema>
export type SubtitlesTranslationPosition = z.infer<typeof subtitlesTranslationPositionSchema>
export type SubtitlesFontFamily = z.infer<typeof subtitlesFontFamilySchema>
export type SubtitleTextStyle = z.infer<typeof subtitleTextStyleSchema>
export type SubtitleContainerStyle = z.infer<typeof subtitleContainerStyleSchema>
export type SubtitlesStyle = z.infer<typeof subtitlesStyleSchema>
export type SubtitlePosition = z.infer<typeof subtitlePositionSchema>
export type VideoSubtitles = z.infer<typeof videoSubtitlesSchema>
