import { describe, expect, test } from "bun:test"
import { executeFailed } from "./execute-tool"

describe("executeFailed", () => {
  test("detects a failed child call", () => {
    expect(
      executeFailed([
        { tool: "read", status: "completed" },
        { tool: "demo.search", status: "error" },
      ]),
    ).toBe(true)
  })

  test("ignores invalid metadata", () => {
    expect(executeFailed(undefined)).toBe(false)
    expect(executeFailed([null, [], { tool: "read" }, { tool: "read", status: "unknown" }])).toBe(false)
  })
})
