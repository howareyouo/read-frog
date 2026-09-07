import { describe, expect, it } from "vitest"
import {
  extractAISDKErrorMessage,
  extractErrorMessage,
  toUserFacingErrorMessage,
} from "./extract-message"

const cloudflare502 = `<!DOCTYPE html>
<html class="no-js" lang="en-US">
<head>
<title>p0.systems | 502: Bad gateway</title>
</head>
<body>
<span class="code-label">Error code 502</span>
</body>
</html>`

describe("toUserFacingErrorMessage", () => {
  it("extracts the HTML title from a Cloudflare error page", () => {
    expect(toUserFacingErrorMessage(cloudflare502)).toBe("p0.systems | 502: Bad gateway")
  })

  it("does not keep raw markup", () => {
    expect(toUserFacingErrorMessage(cloudflare502)).not.toContain("<")
  })
})

describe("extractAISDKErrorMessage", () => {
  it("does not dump HTML response bodies into the toast", () => {
    expect(
      extractAISDKErrorMessage({
        message: "Something went wrong",
        responseBody: cloudflare502,
      }),
    ).toBe("p0.systems | 502: Bad gateway")
  })

  it("sanitizes HTML stuffed into message", () => {
    expect(extractAISDKErrorMessage({ message: cloudflare502 })).toBe(
      "p0.systems | 502: Bad gateway",
    )
  })
})

describe("extractErrorMessage", () => {
  it("uses status text when the body is a gateway HTML page", async () => {
    const response = new Response(cloudflare502, {
      status: 502,
      statusText: "Bad Gateway",
    })
    await expect(extractErrorMessage(response)).resolves.toBe("p0.systems | 502: Bad gateway")
  })
})
