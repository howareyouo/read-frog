import type { FeatureKey } from "@/utils/constants/feature-providers"
import {
  buildFeatureProviderIdsPatch,
  FEATURE_KEYS,
  FEATURE_PROVIDER_DEFS,
} from "@/utils/constants/feature-providers"
import {
  GOOGLE_TRANSLATE_PROVIDER_ID,
  MICROSOFT_TRANSLATE_PROVIDER_ID,
} from "@/utils/constants/providers"
import { isGoogleTranslateReachable } from "@/utils/host/translate/api/google"
import { logger } from "@/utils/logger"
import { mergeWithArrayOverwrite } from "@/utils/merge"
import { getLocalConfigAndMeta, setLocalConfig } from "./storage"

/**
 * Pick better translate providers once, after a fresh install.
 *
 * A fresh config ships with Microsoft Translate because it works everywhere, including the
 * networks where Google is blocked — that keeps install itself off the network, so the first
 * config write and the guide tab never wait on a probe that, on a blocked network, does not
 * fail fast but simply hangs. Once the user is set up we probe the real Google endpoint:
 * where Google answers, every translate feature still holding the Microsoft default moves to
 * Google, the better provider where it works. Slots the user already changed keep their
 * choice; where Google is blocked, the Microsoft default stays.
 */
export async function selectFreshTranslateProviders(): Promise<void> {
  if (await isGoogleTranslateReachable()) {
    await promoteMicrosoftDefaultsToGoogle()
  }
}

/** Move every translate feature still pointing at the Microsoft default onto Google. */
async function promoteMicrosoftDefaultsToGoogle(): Promise<void> {
  const { value: config } = await getLocalConfigAndMeta()

  const assignmentsIds: Partial<Record<FeatureKey, string[]>> = {}
  for (const featureKey of FEATURE_KEYS) {
    const providerIds = FEATURE_PROVIDER_DEFS[featureKey].getProviderIds(config)
    // Rotation may hold Microsoft even when the primary has moved on —
    // rewrite it wherever the Microsoft default still appears.
    if (!providerIds.includes(MICROSOFT_TRANSLATE_PROVIDER_ID)) continue
    assignmentsIds[featureKey] = providerIds.map((id) =>
      id === MICROSOFT_TRANSLATE_PROVIDER_ID ? GOOGLE_TRANSLATE_PROVIDER_ID : id,
    )
  }
  if (Object.keys(assignmentsIds).length === 0) {
    return
  }

  await setLocalConfig(
    mergeWithArrayOverwrite(config, buildFeatureProviderIdsPatch(assignmentsIds)),
  )
  logger.info("[Config] Google Translate reachable, promoted it to the default translate provider")
}
