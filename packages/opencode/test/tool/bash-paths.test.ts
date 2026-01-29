import { describe, expect, test } from "bun:test"
import { externalDirectoryGlob } from "../../src/tool/bash"

describe("tool.bash path normalization", () => {
  if (process.platform !== "win32") return

  test("converts MSYS paths to drive-letter posix", () => {
    expect(externalDirectoryGlob("/c/Users/Luke/file.txt")).toBe("C:/Users/Luke/*")
  })

  test("preserves UNC shares", () => {
    expect(externalDirectoryGlob("\\\\server\\share\\file.txt")).toBe("//server/share/*")
  })

  test("never returns backslashes", () => {
    expect(externalDirectoryGlob("C:\\Users\\Luke\\file.txt")).not.toContain("\\")
  })
})
