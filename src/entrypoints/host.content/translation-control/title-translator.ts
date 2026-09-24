import { translateTextForPageTitle } from "@/utils/host/translate/translate-variants"
import { getOrCreateWebPageContext } from "@/utils/host/translate/webpage-context"
import { logger } from "@/utils/logger"
import { isTranslationCancelledError } from "@/utils/request/cancellation"

/**
 * Document-title translation for one page-translation session, moved verbatim
 * out of PageTranslationManager. `isActive` reports the manager's live
 * translation state, consulted at the same points the manager's
 * `isPageTranslating` flag was read before the extraction.
 */
export class TitleTranslator {
  private titleObserver: MutationObserver | null = null
  private lastSourceTitle: string | null = null
  private lastAppliedTranslatedTitle: string | null = null
  private titleRequestVersion = 0
  private isActive: () => boolean

  constructor(isActive: () => boolean) {
    this.isActive = isActive
  }

  private shouldManageDocumentTitle(): boolean {
    return window === window.top
  }

  async primeDocumentTitleContext(shouldPrimeWebPageContext: boolean): Promise<void> {
    if (!this.shouldManageDocumentTitle() || !shouldPrimeWebPageContext) {
      return
    }

    try {
      await getOrCreateWebPageContext()
    } catch (error) {
      logger.warn("Failed to prime webpage context before translating document title:", error)
    }
  }

  startDocumentTitleTracking(): void {
    if (!this.shouldManageDocumentTitle()) {
      return
    }

    this.lastSourceTitle = document.title || ""
    this.lastAppliedTranslatedTitle = null
    this.titleRequestVersion = 0

    this.observeDocumentTitle()
    void this.syncDocumentTitle(this.lastSourceTitle)
  }

  stopDocumentTitleTracking(): void {
    if (!this.shouldManageDocumentTitle()) {
      return
    }

    const currentTitle = document.title || ""
    if (currentTitle !== this.lastAppliedTranslatedTitle) {
      this.lastSourceTitle = currentTitle
    }

    if (this.titleObserver) {
      this.titleObserver.disconnect()
      this.titleObserver = null
    }

    this.titleRequestVersion++

    if (this.lastSourceTitle !== null && document.title !== this.lastSourceTitle) {
      document.title = this.lastSourceTitle
    }

    this.lastSourceTitle = null
    this.lastAppliedTranslatedTitle = null
  }

  private observeDocumentTitle(): void {
    if (!document.head) {
      return
    }

    if (this.titleObserver) {
      this.titleObserver.disconnect()
    }

    this.titleObserver = new MutationObserver(() => {
      this.handleDocumentTitleMutation()
    })

    this.titleObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }

  private handleDocumentTitleMutation(): void {
    if (!this.isActive() || !this.shouldManageDocumentTitle()) {
      return
    }

    const currentTitle = document.title || ""

    if (currentTitle === this.lastSourceTitle) {
      return
    }

    if (currentTitle === this.lastAppliedTranslatedTitle) {
      return
    }

    this.lastSourceTitle = currentTitle
    void this.syncDocumentTitle(currentTitle)
  }

  private async syncDocumentTitle(sourceTitle: string): Promise<void> {
    if (!sourceTitle.trim() || !this.isActive() || !this.shouldManageDocumentTitle()) {
      return
    }

    const requestVersion = ++this.titleRequestVersion

    try {
      const translatedTitle = await translateTextForPageTitle(sourceTitle)
      if (!this.isActive() || requestVersion !== this.titleRequestVersion) {
        return
      }

      const nextTitle = translatedTitle || sourceTitle
      this.lastAppliedTranslatedTitle = nextTitle

      if (document.title === nextTitle) {
        return
      }

      document.title = nextTitle
    } catch (error) {
      // A cancelled session's title request rejecting is expected, not noise.
      if (isTranslationCancelledError(error)) return
      if (requestVersion === this.titleRequestVersion) {
        logger.warn("Failed to translate document title:", error)
      }
    }
  }
}
