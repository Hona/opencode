import { describe, expect, test } from "bun:test"
import { tabsDrawerHasCloseButton } from "./help-button-visibility"

describe("tabs drawer close button", () => {
  test("is hidden only on Windows desktop", () => {
    expect(tabsDrawerHasCloseButton("desktop", "windows")).toBe(false)
    expect(tabsDrawerHasCloseButton("desktop", "macos")).toBe(true)
    expect(tabsDrawerHasCloseButton("desktop", "linux")).toBe(true)
    expect(tabsDrawerHasCloseButton("web")).toBe(true)
  })
})
