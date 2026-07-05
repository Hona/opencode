import { describe, expect, test } from "bun:test"
import { applyServerFormEvent } from "./dialog-select-server-domain"

describe("applyServerFormEvent", () => {
  test("resets and reports successful completion", () => {
    const calls: string[] = []

    applyServerFormEvent(
      "complete",
      () => calls.push("reset"),
      { onFormComplete: () => calls.push("complete") },
      () => calls.push("mutation"),
    )

    expect(calls).toEqual(["reset", "mutation", "complete"])
  })

  test("resets and reports external invalidation", () => {
    const calls: string[] = []

    applyServerFormEvent("invalidated", () => calls.push("reset"), {
      onFormInvalidated: () => calls.push("invalidated"),
    })

    expect(calls).toEqual(["reset", "invalidated"])
  })

  test("keeps legacy reset behavior without callbacks", () => {
    let resets = 0
    applyServerFormEvent("complete", () => resets++)
    applyServerFormEvent("invalidated", () => resets++)
    expect(resets).toBe(2)
  })
})
