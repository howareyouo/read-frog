/**
 * Lightweight readability-style main-content extraction that runs directly on
 * the live document inside a content script — no external dependency, no
 * DOMParser, no message round-trip.
 *
 * The output feeds AI prompt context and is truncated to
 * WEB_PAGE_CONTENT_CHAR_LIMIT afterwards, so recall of the main text matters
 * far more than formatting fidelity: the result is plain text, not markdown.
 *
 * Strategy: clone the body, prune known boilerplate (structural tags plus
 * class/id tokens), score text blocks (p, pre, blockquote, li, dd) by length,
 * and pick the highest-scoring parent as the content container — lifting to a
 * shared parent when a sibling holds a comparable share of the text, or
 * climbing up while the container still looks thin. Returns "" when nothing
 * readable survives, so callers can fall back to raw body text.
 */

// Blocks that drive container scoring.
const SCORE_BLOCK_SELECTOR = "p, pre, blockquote, li, dd"
// Blocks whose text is emitted (ancestor blocks win over nested descendants,
// so each piece of text is emitted exactly once).
const OUTPUT_BLOCK_SELECTOR = "p, pre, blockquote, li, dd, dt, h1, h2, h3, h4, h5, h6"
// Wrappers that mark genuine article containers rather than ad-hoc divs.
const SEMANTIC_CONTAINER_SELECTOR = "article, main, [role='main']"

// Non-content tags removed wholesale before scoring. Media and form elements
// contribute no readable text, and structural boilerplate tags do more harm
// than the class heuristics below.
const PRUNE_TAG_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "svg",
  "canvas",
  "img",
  "picture",
  "video",
  "audio",
  "source",
  "track",
  "map",
  "form",
  "input",
  "select",
  "textarea",
  "button",
  "label",
  "fieldset",
  "datalist",
  "dialog",
  "nav",
  "header",
  "footer",
  "aside",
].join(",")

// Class/id tokens (tokenized on non-alphanumerics, so "sidebar-left" hits
// "sidebar") that mark boilerplate. Deliberately conservative: missing a token
// only adds noise to a 2000-char prompt context, but a false positive can
// discard real content.
const BOILERPLATE_TOKENS = new Set([
  "ad",
  "ads",
  "advert",
  "advertisement",
  "advertising",
  "adsense",
  "banner",
  "promo",
  "promotion",
  "sponsor",
  "sponsored",
  "sidebar",
  "widget",
  "comments",
  "comment",
  "disqus",
  "menu",
  "nav",
  "navbar",
  "navigation",
  "breadcrumb",
  "breadcrumbs",
  "pagination",
  "pager",
  "footer",
  "header",
  "masthead",
  "topbar",
  "toolbar",
  "cookie",
  "cookies",
  "consent",
  "gdpr",
  "cmp",
  "social",
  "share",
  "sharing",
  "related",
  "recommend",
  "recommended",
  "recommendations",
  "popular",
  "trending",
  "newsletter",
  "subscribe",
  "subscription",
  "signup",
  "signin",
  "login",
  "register",
  "popup",
  "modal",
  "overlay",
  "drawer",
  "tooltip",
  "toast",
  "notification",
  "notifications",
  "search",
  "byline",
  "author",
  "avatar",
  "bio",
  "copyright",
  "disclaimer",
  "credits",
  "skip",
  "sr-only",
  "visually-hidden",
  "screen-reader",
  "rating",
  "stars",
  "vote",
  "votes",
  "voting",
  "poll",
  "tags",
  "categories",
  "meta",
  "metadata",
  "postmeta",
])

// Blocks shorter than this are noise (buttons, captions, link fragments).
const MIN_BLOCK_TEXT_LENGTH = 25
// Per-block score cap so one oversized block cannot dominate.
const MAX_BLOCK_SCORE = 600
// Lift to a shared parent when a sibling holds at least this share of the
// top container's score (multi-wrapper articles).
const SIBLING_SHARE_THRESHOLD = 0.2
// Climb to the parent while the chosen container holds less text than this.
const MIN_CONTAINER_TEXT_LENGTH = 600
// Below this the extraction is treated as failed and the caller falls back.
const MIN_OUTPUT_TEXT_LENGTH = 100

export function extractWebpageReadableText(doc: Document = document): string {
  if (!doc.body) return ""

  // Work on a clone so the live page is never mutated.
  const root = doc.body.cloneNode(true) as HTMLElement
  pruneBoilerplate(root)

  const container = findContentContainer(root)
  if (!container) return ""

  const text = containerToText(container)
  return text.length >= MIN_OUTPUT_TEXT_LENGTH ? text : ""
}

function pruneBoilerplate(root: HTMLElement) {
  for (const el of root.querySelectorAll(PRUNE_TAG_SELECTOR)) {
    el.remove()
  }
  for (const el of root.querySelectorAll("[hidden], [aria-hidden='true'], [role='navigation']")) {
    el.remove()
  }
  for (const el of root.querySelectorAll("*")) {
    const attributeText = `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`
    if (attributeText.split(/[^a-z0-9]+/i).some((token) => BOILERPLATE_TOKENS.has(token))) {
      el.remove()
    }
  }
}

function findContentContainer(root: HTMLElement): Element | null {
  const scores = new Map<Element, number>()
  for (const block of root.querySelectorAll(SCORE_BLOCK_SELECTOR)) {
    const text = (block.textContent ?? "").trim()
    if (text.length < MIN_BLOCK_TEXT_LENGTH) continue

    const score = Math.min(text.length, MAX_BLOCK_SCORE)
    const parent = block.parentElement
    accumulateScore(scores, parent, score)
    accumulateScore(scores, parent?.parentElement, score / 2)
  }

  let top: Element | null = null
  let topScore = 0
  for (const [candidate, score] of scores) {
    const boosted = candidate.matches(SEMANTIC_CONTAINER_SELECTOR) ? score * 1.25 : score
    if (boosted > topScore) {
      top = candidate
      topScore = boosted
    }
  }
  if (!top) return null

  let container = top
  // If a preceding sibling carries a comparable share of the scored text, the
  // article is split across wrappers — lift once to their shared parent.
  for (
    let sibling = container.previousElementSibling;
    sibling;
    sibling = sibling.previousElementSibling
  ) {
    if ((scores.get(sibling) ?? 0) >= topScore * SIBLING_SHARE_THRESHOLD) {
      container = container.parentElement ?? container
      break
    }
  }
  // Otherwise keep climbing while the container still looks thin.
  while (
    container.parentElement &&
    (container.textContent ?? "").trim().length < MIN_CONTAINER_TEXT_LENGTH
  ) {
    container = container.parentElement
  }
  return container
}

function accumulateScore(
  scores: Map<Element, number>,
  el: Element | null | undefined,
  score: number,
) {
  if (!el) return
  scores.set(el, (scores.get(el) ?? 0) + score)
}

function containerToText(container: Element): string {
  const text = container.textContent ?? ""
  // Emit topmost output blocks only: a nested block's text is already part of
  // its ancestor block's textContent.
  const blocks = [...container.querySelectorAll(OUTPUT_BLOCK_SELECTOR)]
    .filter((block) => !block.parentElement?.closest(OUTPUT_BLOCK_SELECTOR))
    .map((block) => collapseWhitespace(block.textContent))
    .filter((part) => part.length > 0)
    .join("\n")
  return blocks || collapseWhitespace(text)
}

function collapseWhitespace(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim()
}
