import { describe, expect, test } from "bun:test"
import { sessionPanelLayout } from "./session-panel-layout"

describe("sessionPanelLayout", () => {
  test("keeps one owner while changing panel geometry", () => {
    expect(sessionPanelLayout({ side: false, dock: false, files: false })).toEqual({
      visible: false,
      stacked: false,
    })
    expect(sessionPanelLayout({ side: false, dock: true, files: false })).toEqual({
      visible: true,
      stacked: false,
    })
    expect(sessionPanelLayout({ side: true, dock: true, files: false })).toEqual({
      visible: true,
      stacked: true,
    })
  })
})
