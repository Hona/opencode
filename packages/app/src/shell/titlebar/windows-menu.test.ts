import { describe, expect, test } from "bun:test"
import { windowsMenuAccelerator } from "./windows-menu"

describe("Windows app menu", () => {
  test("resolves the new window accelerator", () => {
    expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key: "N", ctrlKey: true, shiftKey: true }))).toBe(
      "window.new",
    )
  })

  test("leaves select all to the focused browser editor", () => {
    expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key: "a", ctrlKey: true }))).toBeUndefined()
    expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key: "A", ctrlKey: true }))).toBeUndefined()
  })

  test("ignores the accelerator without its modifiers", () => {
    expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key: "N" }))).toBeUndefined()
  })
})
