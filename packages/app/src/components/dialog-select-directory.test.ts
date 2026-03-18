import { describe, expect, test } from "bun:test"
import {
  displayPath,
  displaySeparator,
  parentOf,
  rootOf,
  scopeOf,
  searchOf,
} from "./dialog-select-directory-path"

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

  test("preserves UNC share roots for navigation helpers", () => {
    expect(rootOf("\\\\server\\share\\repo")).toBe("//server/share")
    expect(rootOf("\\\\server\\share")).toBe("//server/share")
    expect(parentOf("//server/share/repo")).toBe("//server/share")
    expect(parentOf("\\\\server\\share")).toBe("//server/share")
  })

  test("keeps UNC scoped search rooted at the share", () => {
    expect(scopeOf("\\\\server\\share", "C:/Users/dev", "C:/Users/dev")).toEqual({
      directory: "//server/share",
      path: "",
    })
    expect(scopeOf("\\\\server\\share\\repo", "C:/Users/dev", "C:/Users/dev")).toEqual({
      directory: "//server/share",
      path: "repo",
    })
  })

  test("indexes UNC paths in slash and native forms", () => {
    const search = searchOf("//server/share/repo", "C:\\Users\\dev")
    expect(search).toContain("//server/share/repo")
    expect(search).toContain("\\\\server\\share\\repo")
    expect(search).toContain("repo")
  })
})
