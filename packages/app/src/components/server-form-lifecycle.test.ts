import { describe, expect, test } from "bun:test"
import { completeServerForm } from "./server-form-lifecycle"

describe("completeServerForm", () => {
  test("preserves reset-before-exit ordering", () => {
    const calls: string[] = []

    completeServerForm(
      () => calls.push("reset"),
      () => calls.push("exit"),
      () => calls.push("action"),
    )

    expect(calls).toEqual(["reset", "exit", "action"])
  })

  test("preserves legacy reset behavior without an exit callback", () => {
    let resets = 0

    completeServerForm(() => resets++)

    expect(resets).toBe(1)
  })
})
