import { describe, expect, test } from "bun:test"
import { displayPath, getDirectory, getFilename, getPathSeparator, hasPathDirectory } from "../src/path"

describe("util.path", () => {
  test("preserves native directory separators", () => {
    expect(getDirectory("src/app.ts")).toBe("src/")
    expect(getDirectory("src\\app.ts")).toBe("src\\")
    expect(getDirectory("C:\\repo\\src\\app.ts")).toBe("C:\\repo\\src\\")
    expect(getDirectory("C:/repo/src/app.ts")).toBe("C:/repo/src/")
  })

  test("handles roots and plain filenames", () => {
    expect(getDirectory("/")).toBe("/")
    expect(getDirectory("C:\\")).toBe("C:\\")
    expect(getFilename("/")).toBe("/")
    expect(getFilename("C:\\")).toBe("C:\\")
    expect(getDirectory("README.md")).toBe("")
    expect(getFilename("README.md")).toBe("README.md")
  })

  test("detects when a path has a directory", () => {
    expect(hasPathDirectory("src/app.ts")).toBe(true)
    expect(hasPathDirectory("src\\app.ts")).toBe(true)
    expect(hasPathDirectory("README.md")).toBe(false)
  })

  test("detects path separator from the server path", () => {
    expect(getPathSeparator("src/app.ts")).toBe("/")
    expect(getPathSeparator("src\\app.ts")).toBe("\\")
    expect(getPathSeparator("C:\\repo")).toBe("\\")
  })

  test("shortens paths inside home with native separators", () => {
    expect(displayPath("/Users/me/project", { home: "/Users/me" })).toBe("~/project")
    expect(displayPath("C:\\Users\\me\\project", { home: "C:\\Users\\me" })).toBe("~\\project")
  })

  test("matches windows homes case insensitively", () => {
    expect(displayPath("c:\\Users\\Me\\project", { home: "C:\\users\\me" })).toBe("~\\project")
  })

  test("leaves paths outside home unchanged", () => {
    expect(displayPath("/tmp/project", { home: "/Users/me" })).toBe("/tmp/project")
    expect(displayPath("C:\\work\\project", { home: "C:\\Users\\me" })).toBe("C:\\work\\project")
  })
})
