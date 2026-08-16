import { describe, expect, test } from "bun:test"
import { executeCalls, executeCallSummary } from "./execute-tool"

describe("executeCalls", () => {
  test("reads child calls from execute metadata", () => {
    expect(
      executeCalls([
        { tool: "read", status: "completed", input: { path: "README.md" } },
        { tool: "demo.search", status: "error", input: { query: "one\ntwo" } },
      ]),
    ).toEqual([
      { tool: "read", status: "completed", input: { path: "README.md" } },
      { tool: "demo.search", status: "error", input: { query: "one\ntwo" } },
    ])
  })

  test("ignores invalid child calls", () => {
    expect(
      executeCalls([null, { tool: "read" }, { tool: "read", status: "unknown" }, { tool: 1, status: "error" }]),
    ).toEqual([])
  })
})

describe("executeCallSummary", () => {
  test("shows primitive input on one line", () => {
    expect(
      executeCallSummary({
        tool: "demo.search",
        status: "completed",
        input: { query: "one\ntwo", limit: 5, exact: true, nested: { hidden: true } },
      }),
    ).toBe("query=one two, limit=5, exact=true")
  })
})
