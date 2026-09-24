import type { LangCodeISO6393 } from "@read-frog/definitions"
import { atom } from "jotai"
import { normalizeDetectedCode } from "@/utils/config/languages"
import { DEFAULT_DETECTED_CODE } from "../constants/config"
import { logger } from "../logger"
import { onMessage, sendMessage } from "../message"
import { createSyncedAtom } from "./synced-atom"

// Private base atom - not exported to prevent direct writes
const baseDetectedCodeAtom = createSyncedAtom(DEFAULT_DETECTED_CODE, {
  load: () =>
    sendMessage("getDetectedCode", undefined)
      .then((detectedCode) => normalizeDetectedCode(detectedCode))
      .catch((error) => {
        logger.warn("Failed to refresh active tab detected language", error)
        return DEFAULT_DETECTED_CODE
      }),
  subscribe: (onUpdate) =>
    onMessage("detectedPageLanguageChanged", (msg) => {
      onUpdate(normalizeDetectedCode(msg.data.detectedCode))
    }),
  logLabel: "detectedCodeAtom",
})

// Public atom with read/write - writes only update the in-memory popup state.
export const detectedCodeAtom = atom(
  (get) => get(baseDetectedCodeAtom),
  (_get, set, newValue: LangCodeISO6393) => {
    set(baseDetectedCodeAtom, newValue)
  },
)
