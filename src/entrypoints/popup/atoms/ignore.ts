import { atom } from "jotai"

const EMPTY_TAB_URLS = ["about:blank", "chrome://newtab/", "about:newtab"]

const EXTENSION_URLS = ["chrome://extensions/", "chrome-extension://", "chrome://newtab/"]

export function isIgnoreUrl(url: string): boolean {
  return EMPTY_TAB_URLS.some((u) => url.includes(u)) || EXTENSION_URLS.some((u) => url.includes(u))
}

export const isIgnoreTabAtom = atom<boolean>(false)
