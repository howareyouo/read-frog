// @vitest-environment jsdom
// Repro: click test on model A, then on model B — does A's spinner survive?
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ModelTestButton } from "./model-test-button"

vi.mock("@/utils/message", () => ({
  sendMessage: vi.fn(
    () => new Promise((resolve) => setTimeout(() => resolve({ text: "Hola" }), 200)),
  ),
}))

vi.mock("@/utils/i18n", () => ({
  i18n: { t: (key: string) => key },
}))

const providerConfig = {
  id: "p1",
  provider: "openai" as const,
  name: "OpenAI",
  apiKey: "sk-test",
  baseURL: "https://api.openai.com/v1",
  model: { model: "gpt-x", rotationModels: ["gpt-a", "gpt-b"] },
}

function renderTwoButtons() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ModelTestButton providerConfig={providerConfig as any} modelId="gpt-a" />
      <ModelTestButton providerConfig={providerConfig as any} modelId="gpt-b" />
    </QueryClientProvider>,
  )
}

const spinnerClass = "animate-bounce"

function getButton(container: HTMLElement, index: number) {
  const button = container.querySelectorAll("button")[index]
  if (!button) {
    throw new Error(`button ${index} not found`)
  }
  return button
}

function isTesting(container: HTMLElement, index: number) {
  return getButton(container, index).querySelector(`.${spinnerClass}`) !== null
}

afterEach(cleanup)

describe("ModelTestButton repro", () => {
  it("keeps model A's spinner when model B's test starts", async () => {
    const { container } = renderTwoButtons()

    // click test on model A (first button)
    fireEvent.click(getButton(container, 0))
    await waitFor(() => expect(isTesting(container, 0)).toBe(true))

    // let a render pass
    await new Promise((r) => setTimeout(r, 50))
    expect(isTesting(container, 0)).toBe(true)

    // click test on model B (second button)
    fireEvent.click(getButton(container, 1))
    await waitFor(() => expect(isTesting(container, 1)).toBe(true))

    // A should still be testing
    expect(isTesting(container, 0)).toBe(true)

    await waitFor(() => expect(isTesting(container, 0)).toBe(false), { timeout: 1000 })
    await waitFor(() => expect(isTesting(container, 1)).toBe(false), { timeout: 1000 })
  })
})
