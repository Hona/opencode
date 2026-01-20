import { describe, expect, test } from "bun:test"
import { getDirectory, getFilename, normalize } from "@opencode-ai/util/path"

describe("@opencode-ai/util/path", () => {
  test("normalize handles extended-length Windows prefixes", () => {
    expect(normalize("\\\\?\\C:\\foo\\bar")).toBe("C:/foo/bar")
    expect(normalize("\\\\?\\UNC\\server\\share\\dir\\file.txt")).toBe("//server/share/dir/file.txt")
    expect(normalize("\\\\.\\C:\\foo\\bar")).toBe("C:/foo/bar")
  })

  test("getFilename handles both separators", () => {
    expect(getFilename("foo/bar/baz.txt")).toBe("baz.txt")
    expect(getFilename("foo\\bar\\baz.txt")).toBe("baz.txt")
  })

  test("getDirectory handles both separators", () => {
    expect(getDirectory("foo/bar/baz.txt")).toBe("foo/bar/")
    expect(getDirectory("C:\\foo\\bar.txt")).toBe("C:/foo/")
    expect(getDirectory("\\\\server\\share\\dir\\file.txt")).toBe("//server/share/dir/")
  })
})
