import "@/utils/zod-config"
import { QueryClientProvider } from "@tanstack/react-query"
import { Provider as JotaiProvider } from "jotai"
import * as React from "react"
import { HashRouter } from "react-router"
import { ConfigHydrateProvider } from "@/components/providers/config-hydrate-provider"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { RecoveryBoundary } from "@/components/recovery/recovery-boundary"
import { SidebarProvider } from "@/components/ui/base-ui/sidebar"
import { AnchoredToastProvider, ToastProvider } from "@/components/ui/base-ui/toast"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import { ComposeProviders } from "@/utils/compose-providers"
import { getLocalConfig } from "@/utils/config/storage"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { initI18n } from "@/utils/i18n"
import { LocaleBoundary } from "@/utils/i18n/locale-boundary"
import { renderPersistentReactRoot } from "@/utils/react-root"
import { queryClient } from "@/utils/tanstack-query"
import { applyTheme, getLocalThemeMode, isDarkMode } from "@/utils/theme"
import App from "./app"
import { AppShell } from "./app-shell"
import { SettingsSearch } from "./command-palette/settings-search"
import { ScrollRestoration } from "./navigation/scroll-restoration"
import "@/assets/styles/inter-latin.css"
import "@/assets/styles/theme.css"
import "./style.css"

async function initApp() {
  const root = document.getElementById("root")!
  root.className = "antialiased bg-background"

  const [configValue, themeMode] = await Promise.all([getLocalConfig(), getLocalThemeMode()])
  const config = configValue ?? DEFAULT_CONFIG

  await initI18n(config.uiLanguage)

  applyTheme(document.documentElement, isDarkMode(themeMode) ? "dark" : "light")

  renderPersistentReactRoot(
    root,
    <ComposeProviders
      providers={[
        (children) => <React.StrictMode>{children}</React.StrictMode>,
        (children) => <JotaiProvider>{children}</JotaiProvider>,
        (children) => (
          <ConfigHydrateProvider config={config} themeMode={themeMode}>
            {children}
          </ConfigHydrateProvider>
        ),
        (children) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
        (children) => <HashRouter>{children}</HashRouter>,
        (children) => <SidebarProvider>{children}</SidebarProvider>,
        (children) => <ThemeProvider>{children}</ThemeProvider>,
        (children) => <TooltipProvider>{children}</TooltipProvider>,
        (children) => <LocaleBoundary>{children}</LocaleBoundary>,
        (children) => <ToastProvider>{children}</ToastProvider>,
        (children) => <AnchoredToastProvider>{children}</AnchoredToastProvider>,
        (children) => <RecoveryBoundary>{children}</RecoveryBoundary>,
      ]}
    >
      <ScrollRestoration />
      <AppShell>
        <App />
      </AppShell>
      <SettingsSearch />
    </ComposeProviders>,
  )
}

void initApp()
