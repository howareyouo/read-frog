import { describe, expect, it } from "vitest"
import { reconcileSavedModels } from "./saved-models"

const fetched = ["m-a", "m-b", "m-c"]

describe("reconcileSavedModels", () => {
  it("returns null when the primary already is the first selected model", () => {
    const providerModel = { model: "m-a", rotationModels: ["m-a", "m-b"] }
    expect(reconcileSavedModels(providerModel, fetched)).toBeNull()
  })

  it("overwrites rotationModels down to the fetched intersection, preserving order", () => {
    const providerModel = { model: "m-a", rotationModels: ["m-c", "ghost-1", "m-b", "ghost-2"] }
    expect(reconcileSavedModels(providerModel, fetched)).toMatchObject({
      model: { model: "m-c", rotationModels: ["m-c", "m-b"] },
      prunedCount: 2,
      primaryReplaced: true,
    })
  })

  it("re-pins the primary to the first selected model even when it is still offered", () => {
    // Selection is the source of truth: an unchecked primary must not linger
    // in the rotation pool just because the provider still serves it.
    const providerModel = { model: "m-a", rotationModels: ["m-b"] }
    expect(reconcileSavedModels(providerModel, fetched)).toMatchObject({
      model: { model: "m-b", rotationModels: ["m-b"] },
      prunedCount: 0,
      primaryReplaced: true,
    })
  })

  it("replaces a stale primary with the first surviving saved model", () => {
    const providerModel = { model: "dead-primary", rotationModels: ["ghost", "m-b", "m-c"] }
    expect(reconcileSavedModels(providerModel, fetched)).toMatchObject({
      model: { model: "m-b", rotationModels: ["m-b", "m-c"] },
      prunedCount: 1,
      primaryReplaced: true,
    })
  })

  it("keeps the current primary when no selected model survives", () => {
    // Gateways may serve models their list endpoint omits; with nothing
    // better to pin, the primary must stay.
    const providerModel = { model: "dead-primary", rotationModels: ["ghost-1"] }
    expect(reconcileSavedModels(providerModel, fetched)).toMatchObject({
      model: { model: "dead-primary", rotationModels: [] },
      prunedCount: 1,
      primaryReplaced: false,
    })
  })

  it("compares the trimmed primary id without churning", () => {
    const providerModel = { model: " m-a ", rotationModels: ["m-a", "m-b"] }
    expect(reconcileSavedModels(providerModel, fetched)).toBeNull()
  })
})
