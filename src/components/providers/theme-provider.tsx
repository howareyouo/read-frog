import { useAtom } from "jotai"
import { useLayoutEffect, useMemo, useSyncExternalStore } from "react"
import type { Theme, ThemeMode } from "@/types/config/theme"
import { themeModeAtom } from "@/utils/atoms/theme"
import { createContextWithHook } from "@/utils/react/context"
import { applyTheme } from "@/utils/theme"

interface ThemeContextI {
  theme: Theme
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
}

export const { Context: ThemeContext, useRequiredContext: useTheme } =
  createContextWithHook<ThemeContextI>("useTheme must be used within a ThemeProvider")

export function ThemeProvider({
  children,
  container,
  forcedTheme,
}: {
  children: React.ReactNode
  container?: HTMLElement
  forcedTheme?: Theme
}) {
  const [themeMode, setThemeMode] = useAtom(themeModeAtom)

  const prefersDark = useSyncExternalStore(
    (cb) => {
      const mq = window?.matchMedia?.("(prefers-color-scheme: dark)")
      if (!mq) {
        return () => {}
      }

      mq.addEventListener("change", cb)
      return () => mq.removeEventListener("change", cb)
    },
    () => window?.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false,
  )

  const theme: Theme =
    forcedTheme ?? (themeMode === "system" ? (prefersDark ? "dark" : "light") : themeMode)

  // Apply theme to document or shadow root container
  useLayoutEffect(() => {
    const target = container ?? document.documentElement
    applyTheme(target, theme)
  }, [theme, container])

  const contextValue = useMemo(
    () => ({ theme, themeMode, setThemeMode }),
    [theme, themeMode, setThemeMode],
  )

  return <ThemeContext value={contextValue}>{children}</ThemeContext>
}
