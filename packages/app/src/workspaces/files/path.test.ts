import { describe, expect, test } from "bun:test"
import { createPathHelpers, stripQueryAndHash, unquoteGitPath, encodeFilePath } from "./path"

describe("file path helpers", () => {
  test.each([
    ["/repo", "file:///repo/src/app.ts?x=1#h", "src/app.ts"],
    ["/repo", "/repo/src/app.ts", "src/app.ts"],
    ["/repo", "./src/app.ts", "src/app.ts"],
    ["/repo", "file://src/app.ts", "src/app.ts"],
    ["C:\\repo", "C:\\repo\\src\\app.ts", "src\\app.ts"],
    ["C:\\repo", "C:/repo/src/app.ts", "src/app.ts"],
    ["C:\\repo", "file://C:/repo/src/app.ts", "src/app.ts"],
    ["C:\\repo", "c:\\repo\\src\\app.ts", "src\\app.ts"],
  ])("normalizes %p against the workspace root %p", (root, input, expected) => {
    expect(createPathHelpers(() => root).normalize(input)).toBe(expected)
  })

  test("keeps files outside the workspace absolute", () => {
    const posix = createPathHelpers(() => "/repo")
    expect(posix.normalize("/tmp/out/report.pdf")).toBe("/tmp/out/report.pdf")
    expect(posix.absolute("/tmp/out/report.pdf")).toBe(true)
    expect(posix.absolute("src/app.ts")).toBe(false)
    expect(posix.normalize("file:///tmp/out/report.pdf")).toBe("/tmp/out/report.pdf")
    expect(posix.normalize("/repository/x.ts")).toBe("/repository/x.ts")

    const windows = createPathHelpers(() => "C:\\repo")
    expect(windows.normalize("C:\\tmp\\font.ttf")).toBe("C:\\tmp\\font.ttf")
    expect(windows.normalize("file:///C:/tmp/font.ttf")).toBe("C:/tmp/font.ttf")
    expect(windows.absolute("C:/tmp/font.ttf")).toBe(true)
    expect(windows.normalize("file:///C:/repo/src/app.ts")).toBe("src/app.ts")
  })

  test.each([
    ["/repo", "src/components///", "src/components"],
    ["C:\\repo", "frontend\\", "frontend"],
    ["C:\\repo", "frontend\\src\\", "frontend/src"],
    ["C:\\repo", "C:\\repo\\frontend\\", "frontend"],
    ["C:/repo", "frontend\\src\\", "frontend/src"],
    ["\\\\server\\share", "\\\\server\\share\\frontend\\", "frontend"],
    ["/repo", "literal\\name\\", "literal\\name\\"],
    ["/repo", "literal\\name/", "literal\\name"],
  ])("normalizes the directory %p against the workspace root %p", (root, input, expected) => {
    expect(createPathHelpers(() => root).normalizeDir(input)).toBe(expected)
  })

  test.each([
    { name: "stripQueryAndHash", transform: stripQueryAndHash, input: "a/b.ts#L12?x=1", expected: "a/b.ts" },
    { name: "stripQueryAndHash", transform: stripQueryAndHash, input: "a/b.ts?x=1#L12", expected: "a/b.ts" },
    { name: "stripQueryAndHash", transform: stripQueryAndHash, input: "a/b.ts", expected: "a/b.ts" },
    { name: "unquoteGitPath", transform: unquoteGitPath, input: '"a/\\303\\251.txt"', expected: "a/\u00e9.txt" },
    { name: "unquoteGitPath", transform: unquoteGitPath, input: '"plain\\nname"', expected: "plain\nname" },
    { name: "unquoteGitPath", transform: unquoteGitPath, input: "a/b/c.ts", expected: "a/b/c.ts" },
  ])("$name($input) is $expected", ({ transform, input, expected }) => {
    expect(transform(input)).toBe(expected)
  })
})

describe("encodeFilePath", () => {
  const rows = [
    ["/home/user/project/README.md", "/home/user/project/README.md"],
    ["/home/user/file#name with spaces.txt", "/home/user/file%23name%20with%20spaces.txt"],
    ["/path/to/file#with?special%chars&more.txt", "/path/to/file%23with%3Fspecial%25chars%26more.txt"],
    ["/path/to/file?name.txt", "/path/to/file%3Fname.txt"],
    ["/path/to/file%name.txt", "/path/to/file%25name.txt"],
    ["/home/user/文档/README.md", "/home/user/%E6%96%87%E6%A1%A3/README.md"],
    ["/", "/"],
    ["", ""],
    ["//path//to///file.txt", "//path//to///file.txt"],
    ["src/components/App.tsx", "src/components/App.tsx"],
    ["src\\components\\App.tsx", "src/components/App.tsx"],
    ["D:\\dev\\projects\\opencode\\README.bs.md", "/D:/dev/projects/opencode/README.bs.md"],
    ["D:\\dev\\projects\\opencode/README.bs.md", "/D:/dev/projects/opencode/README.bs.md"],
    ["C:\\Program Files\\MyApp\\file with spaces.txt", "/C:/Program%20Files/MyApp/file%20with%20spaces.txt"],
    ["D:\\projects\\file#name with ?marks.txt", "/D:/projects/file%23name%20with%20%3Fmarks.txt"],
    ["C:\\", "/C:/"],
    ["c:\\users\\test\\file.txt", "/c:/users/test/file.txt"],
    ["D:", "/D:"],
    ["C:\\Users\\test\\", "/C:/Users/test/"],
    ["C:\\Users\\..\\test\\.\\file.txt", "/C:/Users/../test/./file.txt"],
    ["/D:/path/file.txt", "/D:/path/file.txt"],
  ] as const

  test.each(rows)("encodes %p as %p", (input, expected) => {
    expect(encodeFilePath(input)).toBe(expected)
  })

  test("every encoded path forms a file URL that keeps its query", () => {
    rows.forEach(([input]) => {
      const url = new URL(`file://${encodeFilePath(input)}?start=10`)
      expect(url.protocol).toBe("file:")
      expect(url.searchParams.get("start")).toBe("10")
    })
  })
})
