import { describe, expect, test } from "bun:test"
import { effectiveFileTreeOpen } from "./file-tree-v2-domain"

describe("effectiveFileTreeOpen", () => {
  test("opens filtered ancestors without changing manual expansion", () => {
    const filter = { dirs: new Set(["src", "src/components"]) }
    const expanded = false

    expect(effectiveFileTreeOpen({ path: "src", expanded, filter })).toBe(true)
    expect(effectiveFileTreeOpen({ path: "src/components", expanded, filter })).toBe(true)
    expect(expanded).toBe(false)
  })

  test("preserves an explicit collapse while filtering", () => {
    const filter = { dirs: new Set(["src"]) }

    expect(effectiveFileTreeOpen({ path: "src", expanded: false, filter, collapsed: true })).toBe(false)
  })

  test("preserves manual expansion outside a filter", () => {
    expect(effectiveFileTreeOpen({ path: "src", expanded: true })).toBe(true)
    expect(effectiveFileTreeOpen({ path: "src", expanded: false })).toBe(false)
  })
})
