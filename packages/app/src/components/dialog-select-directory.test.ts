import { describe, expect, test } from "bun:test"
import {
  getParentPath,
  getPathDisplay,
  getPathDisplaySeparator,
  getPathRoot,
  getPathScope,
  getPathSearchText,
} from "@opencode-ai/util/path"

describe("dialog select directory display", () => {
  test("keeps posix paths looking posix", () => {
    expect(getPathDisplay("/Users/dev/repo", "", "/Users/dev")).toBe("~/repo")
    expect(getPathDisplaySeparator("~/repo", "/Users/dev")).toBe("/")
  })

  test("renders windows home paths with native separators", () => {
    expect(getPathDisplay("C:/Users/dev/repo", "", "C:\\Users\\dev")).toBe("~\\repo")
    expect(getPathDisplaySeparator("~\\repo", "C:\\Users\\dev")).toBe("\\")
  })

  test("renders absolute windows paths with backslashes", () => {
    expect(getPathDisplay("C:/Users/dev/repo", "C:\\", "C:\\Users\\dev")).toBe("C:\\Users\\dev\\repo")
    expect(getPathDisplay("//server/share/repo", "\\\\server\\", "C:\\Users\\dev")).toBe(
      "\\\\server\\share\\repo",
    )
  })

  test("preserves UNC share roots for navigation helpers", () => {
    expect(getPathRoot("\\\\server\\share\\repo")).toBe("//server/share")
    expect(getPathRoot("\\\\server\\share")).toBe("//server/share")
    expect(getParentPath("//server/share/repo")).toBe("//server/share")
    expect(getParentPath("\\\\server\\share")).toBe("//server/share")
  })

  test("keeps UNC scoped search rooted at the share", () => {
    expect(getPathScope("\\\\server\\share", "C:/Users/dev", "C:/Users/dev")).toEqual({
      directory: "//server/share",
      path: "",
    })
    expect(getPathScope("\\\\server\\share\\repo", "C:/Users/dev", "C:/Users/dev")).toEqual({
      directory: "//server/share",
      path: "repo",
    })
  })

  test("indexes UNC paths in slash and native forms", () => {
    const search = getPathSearchText("//server/share/repo", "C:\\Users\\dev")
    expect(search).toContain("//server/share/repo")
    expect(search).toContain("\\\\server\\share\\repo")
    expect(search).toContain("repo")
  })
})
