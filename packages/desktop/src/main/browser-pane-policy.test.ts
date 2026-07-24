import { describe, expect, test } from "bun:test"
import {
  allowedBrowserURL,
  browserBottomMasks,
  normalizeBrowserBounds,
  normalizeBrowserRef,
  normalizeBrowserURL,
} from "./browser-pane-policy"

describe("browser pane policy", () => {
  test("normalizes browser URLs", () => {
    expect(normalizeBrowserURL("localhost:3000/test")).toBe("http://localhost:3000/test")
    expect(normalizeBrowserURL("example.com")).toBe("https://example.com/")
    expect(normalizeBrowserURL("https://example.com/path")).toBe("https://example.com/path")
    expect(normalizeBrowserURL("file:///tmp/clicker/index.html")).toBe("file:///tmp/clicker/index.html")
  })

  test("rejects unsafe browser URLs", () => {
    expect(() => normalizeBrowserURL("javascript:alert(1)")).toThrow()
    expect(() => normalizeBrowserURL("https://user:pass@example.com")).toThrow()
    expect(allowedBrowserURL("data:text/html,test")).toBe(false)
    expect(allowedBrowserURL("file:///tmp/clicker/index.html")).toBe(true)
  })

  test("clamps browser bounds to the parent content view", () => {
    expect(
      normalizeBrowserBounds({ x: 90.4, y: 40.6, width: 50.2, height: 70.8 }, { x: 0, y: 0, width: 120, height: 100 }),
    ).toEqual({ x: 90, y: 41, width: 30, height: 59 })
    expect(
      normalizeBrowserBounds({ x: 10, y: 10, width: 0, height: 20 }, { x: 0, y: 0, width: 100, height: 100 }),
    ).toBeUndefined()
  })

  test("builds bottom-only corner masks", () => {
    expect(browserBottomMasks({ x: 100, y: 50, width: 400, height: 300 })).toEqual([
      { x: 100, y: 348, width: 6, height: 2 },
      { x: 494, y: 348, width: 6, height: 2 },
      { x: 100, y: 346, width: 3, height: 2 },
      { x: 497, y: 346, width: 3, height: 2 },
      { x: 100, y: 344, width: 2, height: 2 },
      { x: 498, y: 344, width: 2, height: 2 },
      { x: 100, y: 340, width: 1, height: 4 },
      { x: 499, y: 340, width: 1, height: 4 },
    ])
  })

  test("accepts browser refs with or without the display prefix", () => {
    expect(normalizeBrowserRef("e2")).toBe("@e2")
    expect(normalizeBrowserRef("@e2")).toBe("@e2")
  })
})
