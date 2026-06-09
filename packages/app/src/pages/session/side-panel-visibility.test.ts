import { describe, expect, test } from "bun:test"
import { shouldShowFileTree } from "./side-panel-visibility"

describe("shouldShowFileTree", () => {
  test("hides a disabled v2 file tree even when its persisted panel state is open", () => {
    expect(shouldShowFileTree({ desktopV2: true, showFileTree: false, opened: true })).toBe(false)
  })

  test("keeps legacy and enabled v2 file trees visible", () => {
    expect(shouldShowFileTree({ desktopV2: false, showFileTree: false, opened: true })).toBe(true)
    expect(shouldShowFileTree({ desktopV2: true, showFileTree: true, opened: true })).toBe(true)
  })
})
