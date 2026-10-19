import "@/utils/zod-config"
import { QueryClientProvider } from "@tanstack/react-query"
import { Provider as JotaiProvider } from "jotai"
import { useHydrateAtoms } from "jotai/utils"
import * as React from "react"
import { browser } from "#imports"
import { ConfigHydrateProvider } from "@/components/providers/config-hydrate-provider"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { RecoveryBoundary } from "@/components/recovery/recovery-boundary"
import { ToastProvider } from "@/components/ui/base-ui/toast"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import { getLocalConfig } from "@/utils/config/storage"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { initI18n } from "@/utils/i18n"
import { LocaleBoundary } from "@/utils/i18n/locale-boundary"
import { sendMessage } from "@/utils/message"
import { renderPersistentReactRoot } from "@/utils/react-root"
import { queryClient } from "@/utils/tanstack-query"
import { getLocalThemeMode } from "@/utils/theme"
import App from "./app"
import {
  getIsInPatterns,
  isCurrentSiteInPatternsAtom,
  isPageTranslatedAtom,
} from "./atoms/auto-translate"
import { isIgnoreTabAtom, isIgnoreUrl } from "./atoms/ignore"
import {
  isCurrentSiteInBlacklistAtom,
  isCurrentSiteInWhitelistAtom,
  isInSiteControlList,
} from "./atoms/site-control"
import "@fontsource-variable/inter/index.css"
import "@/assets/styles/text-small.css"
import "@/assets/styles/theme.css"

function HydrateAtoms({
  initialValues,
  children,
}: {
  initialValues: [
    [typeof isPageTranslatedAtom, boolean],
    [typeof isCurrentSiteInPatternsAtom, boolean],
    [typeof isIgnoreTabAtom, boolean],
    [typeof isCurrentSiteInWhitelistAtom, boolean],
    [typeof isCurrentSiteInBlacklistAtom, boolean],
  ]
  children: React.ReactNode
}) {
  useHydrateAtoms(initialValues)
  return children
}

async function initApp() {
  const root = document.getElementById("root")!
  root.className = "text-base antialiased w-[320px] bg-background dark:bg-neutral-900"

  const [configValue, themeMode, activeTab] = await Promise.all([
    getLocalConfig(),
    getLocalThemeMode(),
    browser.tabs.query({
      active: true,
      currentWindow: true,
    }),
  ])
  const config = configValue ?? DEFAULT_CONFIG

  await initI18n(config.uiLanguage)

  const tabId = activeTab[0]!.id

  let isPageTranslated: boolean = false
  if (tabId) {
    isPageTranslated = await sendMessage("getEnablePageTranslation", { tabId })
  }

  const isInPatterns = tabId ? await getIsInPatterns(config.pageTranslation) : false

  const activeTabUrl = activeTab[0]?.url || ""
  const isIgnoreTab = isIgnoreUrl(activeTabUrl)
  const isInWhitelist = activeTabUrl
    ? isInSiteControlList(config.siteControl.whitelistPatterns, activeTabUrl)
    : false
  const isInBlacklist = activeTabUrl
    ? isInSiteControlList(config.siteControl.blacklistPatterns, activeTabUrl)
    : false

  renderPersistentReactRoot(
    root,
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <JotaiProvider>
          <ConfigHydrateProvider config={config} themeMode={themeMode}>
            <HydrateAtoms
              initialValues={[
                [isPageTranslatedAtom, isPageTranslated],
                [isCurrentSiteInPatternsAtom, isInPatterns],
                [isIgnoreTabAtom, isIgnoreTab],
                [isCurrentSiteInWhitelistAtom, isInWhitelist],
                [isCurrentSiteInBlacklistAtom, isInBlacklist],
              ]}
            >
              <ThemeProvider>
                <TooltipProvider>
                  <LocaleBoundary>
                    <ToastProvider>
                      <RecoveryBoundary>
                        <App />
                      </RecoveryBoundary>
                    </ToastProvider>
                  </LocaleBoundary>
                </TooltipProvider>
              </ThemeProvider>
            </HydrateAtoms>
          </ConfigHydrateProvider>
        </JotaiProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  )
}

void initApp()
