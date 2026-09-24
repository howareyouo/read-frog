import { atom } from "jotai"
import type { ThemeMode } from "@/types/config/theme"
import { DEFAULT_THEME_MODE, themeModeSchema } from "@/types/config/theme"
import { THEME_STORAGE_KEY } from "../constants/config"
import { storageAdapter } from "./storage-adapter"
import { createSyncedAtom } from "./synced-atom"

// Private base atom. Only export this for top-level hydration before ThemeProvider mounts.
export const baseThemeModeAtom = createSyncedAtom(DEFAULT_THEME_MODE, {
  load: () => storageAdapter.get<ThemeMode>(THEME_STORAGE_KEY, DEFAULT_THEME_MODE, themeModeSchema),
  subscribe: (onUpdate) => storageAdapter.watch<ThemeMode>(THEME_STORAGE_KEY, onUpdate),
  logLabel: "baseThemeModeAtom",
})

// Public atom with read/write - write always goes through storageAdapter
export const themeModeAtom = atom(
  (get) => get(baseThemeModeAtom),
  async (get, set, newValue: ThemeMode) => {
    const prev = get(baseThemeModeAtom)
    set(baseThemeModeAtom, newValue)
    try {
      await storageAdapter.set(THEME_STORAGE_KEY, newValue, themeModeSchema)
    } catch (error) {
      console.error("Failed to set themeMode to storage:", newValue, error)
      set(baseThemeModeAtom, prev)
    }
  },
)
