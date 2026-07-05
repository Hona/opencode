import { describe, expect, test } from "bun:test"
import { effectiveHomeSelection, homeSearchActiveKey } from "./home-domain"

describe("effectiveHomeSelection", () => {
  test("preserves a valid persisted server and project", () => {
    const selection = { server: "remote", directory: "/repo" }

    expect(effectiveHomeSelection(selection, ["local", "remote"], "local")).toBe(selection)
  })

  test("uses the active server without carrying a stale project", () => {
    expect(effectiveHomeSelection({ server: "removed", directory: "/repo" }, ["local", "remote"], "remote")).toEqual({
      server: "remote",
    })
  })

  test("falls back to the first available server", () => {
    expect(effectiveHomeSelection({ server: "removed" }, ["local", "remote"], "missing")).toEqual({ server: "local" })
  })
})

describe("homeSearchActiveKey", () => {
  test("derives a valid active result without synchronizing state", () => {
    expect(homeSearchActiveKey("second", ["first", "second"])).toBe("second")
    expect(homeSearchActiveKey("removed", ["first", "second"])).toBe("first")
    expect(homeSearchActiveKey("first", [])).toBe("")
  })
})
