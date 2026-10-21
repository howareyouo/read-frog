/**
 * Extract error message from API response
 * Handles various error formats: JSON string, { error: { message } }, { message }, plain text
 */

const MAX_ERROR_MESSAGE_LENGTH = 240

function looksLikeHtml(text: string): boolean {
  const head = text.trimStart().slice(0, 2_000)
  return head.startsWith("<") && /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(head)
}

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * Collapse gateway HTML / oversized bodies into a short toast-safe string.
 */
export function toUserFacingErrorMessage(
  text: string,
  fallback = "Unexpected error occurred",
): string {
  const trimmed = text.trim()
  if (!trimmed) return fallback

  if (looksLikeHtml(trimmed)) {
    const title = trimmed
      .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      .trim()
    if (title) return decodeBasicHtmlEntities(title)

    const code = trimmed.match(/Error code\s+(\d{3})/i)?.[1]
    if (code) return `${code} ${fallback}`

    return fallback
  }

  const oneLine = trimmed.replace(/\s+/g, " ")
  if (oneLine.length <= MAX_ERROR_MESSAGE_LENGTH) return oneLine
  return `${oneLine.slice(0, MAX_ERROR_MESSAGE_LENGTH - 1)}…`
}

export async function extractErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`
  const text = await response.text()

  if (!text) return fallback

  try {
    const json = JSON.parse(text)
    if (typeof json === "string") return toUserFacingErrorMessage(json, fallback)
    if (json.error?.message) return toUserFacingErrorMessage(String(json.error.message), fallback)
    if (json.message) return toUserFacingErrorMessage(String(json.message), fallback)
    return fallback
  } catch {
    return toUserFacingErrorMessage(text, fallback)
  }
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function extractAISDKErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return toUserFacingErrorMessage(error)
  }

  if (typeof error === "object" && error !== null) {
    const source = error as {
      message?: unknown
      responseBody?: unknown
      text?: unknown
    }

    const message = getNonEmptyString(source.message)
    const responseBody = getNonEmptyString(source.responseBody)
    const text = getNonEmptyString(source.text)

    const raw = isGenericAISDKErrorMessage(message)
      ? (responseBody ?? text ?? message ?? "Unexpected error occurred")
      : (message ?? responseBody ?? text ?? "Unexpected error occurred")

    return toUserFacingErrorMessage(raw)
  }

  return "Unexpected error occurred"
}

function isGenericAISDKErrorMessage(message: string | undefined): boolean {
  if (!message) {
    return true
  }

  const normalizedMessage = message.trim().toLowerCase()
  return (
    normalizedMessage === "something went wrong" ||
    normalizedMessage === "unexpected error occurred"
  )
}
