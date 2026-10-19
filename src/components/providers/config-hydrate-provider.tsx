import { useHydrateAtoms } from "jotai/utils"
import type { Config } from "@/types/config/config"
import type { ThemeMode } from "@/types/config/theme"
import { configAtom } from "@/utils/atoms/config"
import { baseThemeModeAtom } from "@/utils/atoms/theme"

/**
 * Hydrates the config and base theme mode atoms shared by the React
 * entrypoints. Mount inside `JotaiProvider`; pass only the values that
 * entrypoint previously hydrated.
 */
export function ConfigHydrateProvider({
  config,
  themeMode,
  children,
}: {
  config?: Config
  themeMode?: ThemeMode
  children: React.ReactNode
}) {
  const initialValues: (
    | readonly [typeof configAtom, Config]
    | readonly [typeof baseThemeModeAtom, ThemeMode]
  )[] = []
  if (config) {
    initialValues.push([configAtom, config])
  }
  if (themeMode) {
    initialValues.push([baseThemeModeAtom, themeMode])
  }
  useHydrateAtoms(initialValues)
  return children
}
