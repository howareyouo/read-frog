import { useAtomValue } from "jotai"
import { useCallback, useEffect, useRef } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { translateTextForInput } from "@/utils/host/translate/translate-input"
import { cancelSpinnerAnimation, createBorderSpinner } from "@/utils/host/translate/ui/spinner"

const SPACE_KEY = " "
const TRIGGER_COUNT = 3
const LAST_CYCLE_SWAPPED_KEY = "read-frog-input-translation-last-cycle-swapped"
const SPINNER_ID = "read-frog-input-translation-spinner"

function getLastCycleSwapped(): boolean {
  try {
    return sessionStorage.getItem(LAST_CYCLE_SWAPPED_KEY) === "true"
  } catch {
    return false
  }
}

function setLastCycleSwapped(swapped: boolean): void {
  try {
    sessionStorage.setItem(LAST_CYCLE_SWAPPED_KEY, String(swapped))
  } catch {
    // sessionStorage may not be available
  }
}

/**
 * Create and show a loading spinner near the input element.
 * Reuses the shared border-spinner core from translate/ui/spinner.ts with the
 * page-translation look scaled up: brand-yellow rotating segment.
 */
function showSpinner(element: HTMLElement): () => void {
  // Remove any existing spinner
  document.getElementById(SPINNER_ID)?.remove()

  const spinner = createBorderSpinner(document, {
    size: 10,
    borderWidth: 3,
    trackColor: "#e5e5e5",
    // Brand yellow; set as a var because the host page has no theme variables.
    spinColor: "var(--rf-brand)",
    extraCss: `
      --rf-brand: oklch(76.034% 0.12361 82.191);
      position: absolute !important;
      z-index: 999999 !important;
      pointer-events: none !important;
    `,
  })
  spinner.id = SPINNER_ID

  // Calculate position - vertically centered relative to the element
  const rect = element.getBoundingClientRect()
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const spinnerSize = 16 // 10px + 3px border * 2

  // Vertically center for all element types
  const top = rect.top + scrollY + (rect.height - spinnerSize) / 2
  const left = rect.right + scrollX - spinnerSize - 8

  spinner.style.top = `${top}px`
  spinner.style.left = `${left}px`

  document.body.appendChild(spinner)

  // Return cleanup function
  return () => {
    cancelSpinnerAnimation(spinner)
    spinner.remove()
  }
}

/**
 * Set text content with undo support using execCommand.
 * This allows Ctrl+Z to restore the original text.
 */
function setTextWithUndo(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
  text: string,
) {
  element.focus()

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    // Select all text in input/textarea
    element.select()
    document.execCommand("insertText", false, text)
    element.dispatchEvent(new Event("input", { bubbles: true }))
    return
  }

  if (element.isContentEditable) {
    window.postMessage({ type: "READ_FROG_INPUT_REPLACE", text }, window.location.origin)
  }
}

export function useInputTranslation() {
  const inputTranslationConfig = useAtomValue(configFieldsAtomMap.inputTranslation)
  const spaceTimestampsRef = useRef<number[]>([])
  const isTranslatingRef = useRef(false)

  const handleTranslation = useCallback(
    async (element: HTMLInputElement | HTMLTextAreaElement | HTMLElement) => {
      if (isTranslatingRef.current) return

      // Security: skip password fields to prevent exposing sensitive data
      if (element instanceof HTMLInputElement && element.type === "password") {
        return
      }

      // Get the text content based on element type
      let text: string
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        text = element.value
      } else if (element.isContentEditable) {
        text = element.textContent || ""
      } else {
        return
      }

      // Remove trailing whitespace added by space key presses
      text = text.trim()

      // For input/textarea, trim whitespace immediately (execCommand works reliably).
      // For contenteditable, skip — we'll do a single replacement after translation
      // returns, because rich text editors can't be updated reliably from isolated world.
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        setTextWithUndo(element, text)
      }

      if (!text) {
        return
      }

      // Determine fromLang and toLang, possibly swapped if cycle is enabled
      let fromLang = inputTranslationConfig.fromLang
      let toLang = inputTranslationConfig.toLang

      if (inputTranslationConfig.enableCycle) {
        const wasSwapped = getLastCycleSwapped()
        if (wasSwapped) {
          // Already swapped last time, use original direction
          setLastCycleSwapped(false)
        } else {
          // Swap direction
          ;[fromLang, toLang] = [toLang, fromLang]
          setLastCycleSwapped(true)
        }
      }

      isTranslatingRef.current = true

      // Show spinner near the input element
      const hideSpinner = showSpinner(element)

      // Store original text to detect if user edited during translation
      const originalText = text

      try {
        const translatedText = await translateTextForInput(text, fromLang, toLang)

        // Check if element content changed during translation (user input)
        let currentText: string
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          currentText = element.value
        } else if (element.isContentEditable) {
          currentText = element.textContent || ""
        } else {
          currentText = originalText
        }

        // Only apply translation if content hasn't changed during async operation
        if (currentText.trim() === originalText && translatedText) {
          setTextWithUndo(element, translatedText)
        }
      } catch (error) {
        console.error("Input translation error:", error)
      } finally {
        hideSpinner()
        isTranslatingRef.current = false
      }
    },
    [
      inputTranslationConfig.fromLang,
      inputTranslationConfig.toLang,
      inputTranslationConfig.enableCycle,
    ],
  )

  useEffect(() => {
    if (!inputTranslationConfig.enabled) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only process space key
      if (event.key !== SPACE_KEY) {
        // Reset on any other key
        spaceTimestampsRef.current = []
        return
      }

      // Check if the active element is an input field
      const activeElement = document.activeElement
      const isInputField =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable)

      if (!isInputField || !activeElement) {
        spaceTimestampsRef.current = []
        return
      }

      const now = Date.now()
      const timestamps = spaceTimestampsRef.current

      // Remove timestamps older than threshold
      const timeThreshold = inputTranslationConfig.timeThreshold
      while (timestamps.length > 0 && now - timestamps[0]! > timeThreshold * (TRIGGER_COUNT - 1)) {
        timestamps.shift()
      }

      // Add current timestamp
      timestamps.push(now)

      // Check if we have enough rapid presses
      if (timestamps.length >= TRIGGER_COUNT) {
        // Check if all presses are within the time threshold
        const allWithinThreshold = timestamps.every((ts, i) => {
          if (i === 0) return true
          return ts - timestamps[i - 1]! <= timeThreshold
        })

        if (allWithinThreshold) {
          event.preventDefault()
          spaceTimestampsRef.current = []
          void handleTranslation(activeElement)
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [inputTranslationConfig.enabled, inputTranslationConfig.timeThreshold, handleTranslation])
}
