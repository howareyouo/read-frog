import { describe, expect, it } from "vitest"

describe("extractWebpageReadableText", () => {
  it("extracts the article and drops boilerplate", async () => {
    const { JSDOM } = await import("jsdom")
    const { extractWebpageReadableText } = await import("./readable-text")
    const paragraphs = Array.from(
      { length: 8 },
      (_, i) =>
        `<p>Article paragraph number ${i} with plenty of words to pass the minimum text length threshold for scoring purposes.</p>`,
    ).join("")
    const html = `<!doctype html><html><body>
      <nav class="main-nav"><ul><li>Home</li><li>About</li><li>Contact us here with a long sentence to pass block length.</li></ul></nav>
      <div class="sidebar"><p>Advertisement sidebar text that should be removed by the class token heuristic.</p></div>
      <footer><p>Copyright 2026 Footer Corp, all rights reserved.</p></footer>
      <article><h1>Big Headline</h1>${paragraphs}</article>
      <div class="comments"><p>First comment that should not pollute the output text at all.</p></div>
    </body></html>`
    const text = extractWebpageReadableText(new JSDOM(html).window.document)
    expect(text).toContain("Article paragraph number 0")
    expect(text).toContain("Big Headline")
    expect(text).not.toContain("Advertisement")
    expect(text).not.toContain("Copyright 2026")
    expect(text).not.toContain("First comment")
  })

  it("falls back to empty string on a page with no readable content", async () => {
    const { JSDOM } = await import("jsdom")
    const { extractWebpageReadableText } = await import("./readable-text")
    const html = `<!doctype html><html><body><div><span>hi</span></div></body></html>`
    expect(extractWebpageReadableText(new JSDOM(html).window.document)).toBe("")
  })
})
