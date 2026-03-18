import { describe, expect, test } from "bun:test"
import { displayPath, displaySeparator } from "./dialog-select-directory-path"

describe("dialog select directory display", () => {
  test("keeps posix paths looking posix", () => {
    expect(displayPath("/Users/dev/repo", "", "/Users/dev")).toBe("~/repo")
    expect(displaySeparator("~/repo", "/Users/dev")).toBe("/")
  })

  test("renders windows home paths with native separators", () => {
    expect(displayPath("C:/Users/dev/repo", "", "C:\\Users\\dev")).toBe("~\\repo")
    expect(displaySeparator("~\\repo", "C:\\Users\\dev")).toBe("\\")
  })

  test("renders absolute windows paths with backslashes", () => {
    expect(displayPath("C:/Users/dev/repo", "C:\\", "C:\\Users\\dev")).toBe("C:\\Users\\dev\\repo")
    expect(displayPath("//server/share/repo", "\\\\server\\", "C:\\Users\\dev")).toBe(
      "\\\\server\\share\\repo",
    )
  })
})
