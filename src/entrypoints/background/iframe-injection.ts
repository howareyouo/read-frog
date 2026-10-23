import { browser } from "#imports"
import type { Config } from "@/types/config/config"
import { getLocalConfig } from "@/utils/config/storage"
import { SELECTION_ENABLED_WINDOW_KEY } from "@/utils/content-entry"
import { logger } from "@/utils/logger"
import { isSiteEnabled, SITE_CONTROL_URL_WINDOW_KEY } from "@/utils/site-control"
import { matchDomainPattern } from "@/utils/url"
import type { FrameInfoForSiteControl } from "./iframe-injection-utils"
import { resolveSiteControlUrl } from "./iframe-injection-utils"
import { getPageTranslationEnabled } from "./page-translation-state"

const HOST_CONTENT_SCRIPT_FILE = "/content-scripts/host.js" as const
const IFRAME_FULL_RUNTIME_AUTO_INJECT_PATTERNS = ["browse.library.kiwix.org"] as const

const pendingScriptDocumentKeys = new Set<string>()
const injectedDocumentKeysByFrameAndScript = new Map<string, string>()
const fullRuntimeAutoInjectUrlByTab = new Map<number, string>()

interface FrameInjectionDetails {
  tabId: number
  frameId: number
  documentId?: string
  parentFrameId?: number
  url?: string
}

interface InjectHostContentIntoTabIframesOptions {
  requirePageTranslationEnabled?: boolean
  includeSelectionContent?: boolean
  siteControlUrlOverride?: string
}

function getDocumentInjectionKey(details: FrameInjectionDetails) {
  // documentId is best, but getAllFrames may not expose it. Fall back to URL so
  // explicit per-tab injections still dedupe until the frame navigates.
  return `${details.tabId}:${details.frameId}:${details.documentId ?? details.url ?? "unknown"}`
}

function getFrameInjectionKey(details: { tabId: number; frameId: number }) {
  return `${details.tabId}:${details.frameId}`
}

function getScriptDocumentInjectionKey(details: FrameInjectionDetails) {
  return `${getDocumentInjectionKey(details)}:${HOST_CONTENT_SCRIPT_FILE}`
}

function getScriptFrameInjectionKey(details: FrameInjectionDetails) {
  return `${getFrameInjectionKey(details)}:${HOST_CONTENT_SCRIPT_FILE}`
}

function clearTabDocumentState(tabId: number) {
  for (const key of pendingScriptDocumentKeys) {
    if (key.startsWith(`${tabId}:`)) {
      pendingScriptDocumentKeys.delete(key)
    }
  }

  for (const key of injectedDocumentKeysByFrameAndScript.keys()) {
    if (key.startsWith(`${tabId}:`)) {
      injectedDocumentKeysByFrameAndScript.delete(key)
    }
  }

  fullRuntimeAutoInjectUrlByTab.delete(tabId)
}

function clearFrameInjectedDocumentState(tabId: number, frameId: number) {
  const frameKeyPrefix = `${getFrameInjectionKey({ tabId, frameId })}:`
  for (const key of injectedDocumentKeysByFrameAndScript.keys()) {
    if (key.startsWith(frameKeyPrefix)) {
      injectedDocumentKeysByFrameAndScript.delete(key)
    }
  }
}

function pruneInjectedFrames(tabId: number, liveFrameIds: Set<number>) {
  for (const frameKey of injectedDocumentKeysByFrameAndScript.keys()) {
    if (!frameKey.startsWith(`${tabId}:`)) {
      continue
    }

    const frameId = Number(frameKey.split(":")[1])
    if (!liveFrameIds.has(frameId)) {
      injectedDocumentKeysByFrameAndScript.delete(frameKey)
    }
  }
}

function getParentFrameIdHint(details: object): number | undefined {
  if ("parentFrameId" in details && typeof details.parentFrameId === "number") {
    return details.parentFrameId
  }

  return undefined
}

function setInjectedContentFlags(
  siteControlUrlKey: string,
  siteControlUrl: string,
  selectionEnabledKey: string,
  selectionEnabled: boolean,
) {
  ;(globalThis as Record<string, unknown>)[siteControlUrlKey] = siteControlUrl
  ;(globalThis as Record<string, unknown>)[selectionEnabledKey] = selectionEnabled
}

function getInjectionTarget(details: FrameInjectionDetails) {
  if (details.documentId) {
    return { tabId: details.tabId, documentIds: [details.documentId] }
  }

  return { tabId: details.tabId, frameIds: [details.frameId] }
}

async function getFrameSnapshot(tabId: number): Promise<FrameInfoForSiteControl[]> {
  return (await browser.webNavigation.getAllFrames({ tabId })) ?? []
}

function isFullRuntimeAutoInjectUrl(url: string | undefined): url is string {
  if (!url) return false

  return IFRAME_FULL_RUNTIME_AUTO_INJECT_PATTERNS.some((pattern) =>
    matchDomainPattern(url, pattern),
  )
}

async function getShouldInjectHostContentIntoTabIframes(
  tabId: number,
  existingConfig?: Config | null,
  options: InjectHostContentIntoTabIframesOptions = {},
): Promise<{ config: Config | null; shouldInject: boolean }> {
  const requirePageTranslationEnabled = options.requirePageTranslationEnabled ?? true
  const [isPageTranslationEnabled, config] = await Promise.all([
    requirePageTranslationEnabled ? getPageTranslationEnabled(tabId) : Promise.resolve(true),
    existingConfig === undefined ? getLocalConfig() : Promise.resolve(existingConfig),
  ])

  return {
    config,
    shouldInject: isPageTranslationEnabled,
  }
}

async function injectHostContentIntoFrame(
  details: FrameInjectionDetails,
  frames?: FrameInfoForSiteControl[],
  existingConfig?: Config | null,
  options: InjectHostContentIntoTabIframesOptions = {},
) {
  const documentKey = getDocumentInjectionKey(details)
  const scriptDocumentKey = getScriptDocumentInjectionKey(details)
  const scriptFrameKey = getScriptFrameInjectionKey(details)
  const alreadyInjected =
    pendingScriptDocumentKeys.has(scriptDocumentKey) ||
    injectedDocumentKeysByFrameAndScript.get(scriptFrameKey) === documentKey

  if (alreadyInjected) {
    return
  }

  // The merged content script decides whether to start selection from this
  // flag. Full-runtime frames (URL matching an auto-inject pattern) always
  // get it, even when reached through a generic host-only injection path.
  const includeSelection =
    (options.includeSelectionContent ?? false) || isFullRuntimeAutoInjectUrl(details.url)

  pendingScriptDocumentKeys.add(scriptDocumentKey)

  try {
    let siteControlUrl: string | undefined

    try {
      const [config, frameSnapshot] = await Promise.all([
        existingConfig === undefined ? getLocalConfig() : Promise.resolve(existingConfig),
        frames === undefined ? getFrameSnapshot(details.tabId) : Promise.resolve(frames),
      ])
      const liveFrameIds = new Set(frameSnapshot.map((frame) => frame.frameId))
      liveFrameIds.add(details.frameId)
      pruneInjectedFrames(details.tabId, liveFrameIds)

      siteControlUrl =
        options.siteControlUrlOverride ??
        resolveSiteControlUrl(
          details.frameId,
          details.url,
          frameSnapshot,
          getParentFrameIdHint(details),
        )

      if (!siteControlUrl || !isSiteEnabled(siteControlUrl, config)) {
        return
      }
    } catch (error) {
      logger.error(
        "[Background][IframeInjection] Failed to resolve iframe injection prerequisites",
        error,
      )
      return
    }

    try {
      const target = getInjectionTarget(details) as Parameters<
        typeof browser.scripting.executeScript
      >[0]["target"]

      // Must land before the content script file so the gate sees the
      // owner-page URL and the merged script knows whether to start selection
      // during the same synchronous pass it runs in.
      await browser.scripting.executeScript({
        target,
        func: setInjectedContentFlags,
        args: [
          SITE_CONTROL_URL_WINDOW_KEY,
          siteControlUrl,
          SELECTION_ENABLED_WINDOW_KEY,
          includeSelection,
        ],
      })

      await browser.scripting.executeScript({
        target,
        files: [HOST_CONTENT_SCRIPT_FILE],
      })

      injectedDocumentKeysByFrameAndScript.set(scriptFrameKey, documentKey)
    } catch (error) {
      logger.warn("[Background][IframeInjection] Failed to inject iframe content scripts", error)
    }
  } finally {
    pendingScriptDocumentKeys.delete(scriptDocumentKey)
  }
}

export async function injectHostContentIntoTabIframes(
  tabId: number,
  options: InjectHostContentIntoTabIframesOptions = {},
) {
  let config: Config | null
  let shouldInject: boolean
  try {
    ;({ config, shouldInject } = await getShouldInjectHostContentIntoTabIframes(
      tabId,
      undefined,
      options,
    ))
  } catch (error) {
    logger.warn("[Background][IframeInjection] Failed to resolve iframe injection state", error)
    return
  }

  if (!shouldInject) return

  let frames: FrameInfoForSiteControl[]
  try {
    frames = await getFrameSnapshot(tabId)
  } catch (error) {
    logger.error(
      "[Background][IframeInjection] Failed to resolve tab iframe injection prerequisites",
      error,
    )
    return
  }

  const liveFrameIds = new Set(frames.map((frame) => frame.frameId))
  pruneInjectedFrames(tabId, liveFrameIds)

  await Promise.all(
    frames
      .filter((frame) => frame.frameId !== 0)
      .map((frame) =>
        injectHostContentIntoFrame(
          {
            tabId,
            frameId: frame.frameId,
            parentFrameId: frame.parentFrameId,
            url: frame.url,
          },
          frames,
          config,
          options,
        ),
      ),
  )
}

export async function injectHostContentIntoCurrentTabIframesAfterNodeTranslation(tabId: number) {
  await injectHostContentIntoTabIframes(tabId, { requirePageTranslationEnabled: false })
}

export function setupIframeInjection() {
  browser.tabs.onRemoved.addListener(clearTabDocumentState)
  browser.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0) {
      clearTabDocumentState(details.tabId)
      if (isFullRuntimeAutoInjectUrl(details.url)) {
        fullRuntimeAutoInjectUrlByTab.set(details.tabId, details.url)
      }
      return
    }

    clearFrameInjectedDocumentState(details.tabId, details.frameId)
  })

  // Only page translation eagerly injects host content into newly completed
  // subframes. Top-frame node translation can separately scan existing iframes
  // once, but it does not enable late iframe injection.
  browser.webNavigation.onCompleted.addListener(async (details) => {
    if (details.frameId === 0) {
      if (!isFullRuntimeAutoInjectUrl(details.url)) {
        fullRuntimeAutoInjectUrlByTab.delete(details.tabId)
        return
      }

      fullRuntimeAutoInjectUrlByTab.set(details.tabId, details.url)
      await injectHostContentIntoTabIframes(details.tabId, {
        requirePageTranslationEnabled: false,
        includeSelectionContent: true,
        siteControlUrlOverride: details.url,
      })
      return
    }

    const fullRuntimeAutoInjectUrl =
      fullRuntimeAutoInjectUrlByTab.get(details.tabId) ??
      (isFullRuntimeAutoInjectUrl(details.url) ? details.url : undefined)
    if (fullRuntimeAutoInjectUrl) {
      await injectHostContentIntoFrame(details, undefined, undefined, {
        includeSelectionContent: true,
        siteControlUrlOverride: fullRuntimeAutoInjectUrl,
      })
      return
    }

    let config: Config | null
    let shouldInject: boolean
    try {
      ;({ config, shouldInject } = await getShouldInjectHostContentIntoTabIframes(details.tabId))
      if (!shouldInject) return
    } catch (error) {
      logger.warn("[Background][IframeInjection] Failed to resolve iframe injection state", error)
      return
    }

    await injectHostContentIntoFrame(details, undefined, config)
  })
}
