import { describe, expect, test } from "bun:test"
import {
  decodeFilePath,
  encodeFilePath,
  getDirectory,
  getFilename,
  joinPath,
  normalizeInputPath,
  getParentPath,
  getPathDisplay,
  getPathDisplaySeparator,
  getPathRoot,
  getPathScope,
  getPathSearchText,
  getPathSeparator,
  getRelativeDisplayPath,
  getWorkspaceRelativePath,
  resolveWorkspacePath,
  stripFileProtocol,
  stripQueryAndHash,
  trimPath,
  trimPrettyPath,
  unquoteGitPath,
} from "./path"

describe("path display helpers", () => {
  test("keeps posix separators in displayed directories", () => {
    expect(getDirectory("src/components/app.tsx")).toBe("src/components/")
    expect(getDirectory("/tmp/demo/app.ts")).toBe("/tmp/demo/")
  })

  test("keeps windows separators in displayed directories", () => {
    expect(getDirectory("src\\components\\app.tsx")).toBe("src\\components\\")
    expect(getDirectory("C:\\repo\\src\\app.tsx")).toBe("C:\\repo\\src\\")
    expect(getDirectory("\\\\server\\share\\repo\\app.tsx")).toBe("\\\\server\\share\\repo\\")
  })

  test("extracts filenames across separator styles", () => {
    expect(getFilename("src/components/app.tsx")).toBe("app.tsx")
    expect(getFilename("src\\components\\app.tsx")).toBe("app.tsx")
  })

  test("infers native-looking separators for windows paths", () => {
    expect(getPathSeparator("/tmp/demo")).toBe("/")
    expect(getPathSeparator("C:/repo/src/app.tsx")).toBe("\\")
    expect(getPathSeparator("\\\\server\\share\\repo")).toBe("\\")
  })

  test("keeps UNC roots stable for lexical navigation", () => {
    expect(getPathRoot("\\\\server\\share\\repo")).toBe("//server/share")
    expect(getPathRoot("\\\\server\\share")).toBe("//server/share")
    expect(getParentPath("//server/share/repo")).toBe("//server/share")
    expect(getParentPath("\\\\server\\share")).toBe("//server/share")
  })

  test("keeps windows root forms stable for lexical navigation", () => {
    expect(getPathRoot("C:")).toBe("C:/")
    expect(getParentPath("C:")).toBe("C:/")
    expect(getParentPath("C:/")).toBe("C:/")
  })

  test("normalizes input paths separately from pretty stored paths", () => {
    expect(normalizeInputPath("C:")).toBe("C:/")
    expect(trimPath("\\\\server\\share\\repo\\")).toBe("//server/share/repo")
    expect(trimPrettyPath("C:/Users/dev/repo/")).toBe("C:\\Users\\dev\\repo")
    expect(trimPrettyPath("\\\\server\\share\\repo\\")).toBe("\\\\server\\share\\repo")
  })

  test("joins pretty paths with native separators", () => {
    expect(joinPath("/Users/dev", "repo/src")).toBe("/Users/dev/repo/src")
    expect(joinPath("C:\\Users\\dev", "repo/src")).toBe("C:\\Users\\dev\\repo\\src")
    expect(joinPath("\\\\server\\share", "repo")).toBe("\\\\server\\share\\repo")
    expect(joinPath("C:\\Users\\dev", "C:/tmp/demo")).toBe("C:\\tmp\\demo")
  })

  test("builds picker display text with tilde and native separators", () => {
    expect(getPathDisplay("/Users/dev/repo", "", "/Users/dev")).toBe("~/repo")
    expect(getPathDisplaySeparator("~/repo", "/Users/dev")).toBe("/")
    expect(getPathDisplay("C:/Users/dev/repo", "", "C:\\Users\\dev")).toBe("~\\repo")
    expect(getPathDisplay("//server/share/repo", "\\\\server\\", "C:\\Users\\dev")).toBe(
      "\\\\server\\share\\repo",
    )
  })

  test("scopes picker input from home or absolute roots", () => {
    expect(getPathScope("\\\\server\\share\\repo", "C:/Users/dev", "C:/Users/dev")).toEqual({
      directory: "\\\\server\\share",
      path: "repo",
    })
    expect(getPathScope("~/code", "C:/Users/dev", "C:/Users/dev")).toEqual({
      directory: "C:\\Users\\dev",
      path: "code",
    })
  })

  test("indexes search text in absolute, native, and filename forms", () => {
    const search = getPathSearchText("//server/share/repo", "C:\\Users\\dev")
    expect(search).toContain("//server/share/repo")
    expect(search).toContain("\\\\server\\share\\repo")
    expect(search).toContain("repo")
  })

  test("relativizes display paths from the workspace root", () => {
    expect(getRelativeDisplayPath("/repo/src/app.ts", "/repo")).toBe("/src/app.ts")
    expect(getRelativeDisplayPath("C:\\repo\\src\\", "C:\\repo")).toBe("\\src\\")
    expect(getRelativeDisplayPath("src/app.ts", "C:\\repo")).toBe("src\\app.ts")
    expect(getRelativeDisplayPath("src\\app.ts", "/repo")).toBe("src/app.ts")
    expect(getRelativeDisplayPath("C:/other/app.ts", "C:\\repo")).toBe("C:\\other\\app.ts")
    expect(getRelativeDisplayPath("/other/app.ts", "/repo")).toBe("/other/app.ts")
  })

  test("resolves and relativizes workspace paths across platforms", () => {
    expect(resolveWorkspacePath("/repo", "src/app.ts")).toBe("/repo/src/app.ts")
    expect(resolveWorkspacePath("C:\\repo", "src\\app.ts")).toBe("C:\\repo\\src\\app.ts")
    expect(resolveWorkspacePath("\\\\server\\share\\repo", "src\\app.ts")).toBe("\\\\server\\share\\repo\\src\\app.ts")
    expect(resolveWorkspacePath("/repo", "/tmp/app.ts")).toBe("/tmp/app.ts")

    expect(getWorkspaceRelativePath("/repo/src/app.ts", "/repo")).toBe("src/app.ts")
    expect(getWorkspaceRelativePath("C:/repo/src/app.ts", "C:\\repo")).toBe("src/app.ts")
    expect(getWorkspaceRelativePath("c:\\repo\\src\\app.ts", "C:\\repo")).toBe("src\\app.ts")
    expect(getWorkspaceRelativePath("//server/share/repo/src/app.ts", "\\\\server\\share\\repo")).toBe("src/app.ts")
    expect(getWorkspaceRelativePath("/tmp/app.ts", "/repo")).toBe("/tmp/app.ts")
  })

  test("handles shared file-uri and git path decoding", () => {
    expect(stripFileProtocol("file:///repo/src/app.ts")).toBe("/repo/src/app.ts")
    expect(stripQueryAndHash("a/b.ts#L12?x=1")).toBe("a/b.ts")
    expect(stripQueryAndHash("a/b.ts?x=1#L12")).toBe("a/b.ts")
    expect(decodeFilePath("src/file%23name%20here.ts")).toBe("src/file#name here.ts")
    expect(decodeFilePath("src/%ZZ/file.ts")).toBe("src/%ZZ/file.ts")
    expect(unquoteGitPath('"a/\\303\\251.txt"')).toBe("a/\u00e9.txt")
    expect(unquoteGitPath('"plain\\nname"')).toBe("plain\nname")
  })

  test("encodes file paths for file URIs", () => {
    expect(encodeFilePath("/path/to/file#name.txt")).toBe("/path/to/file%23name.txt")
    expect(encodeFilePath("C:\\Users\\test\\file with spaces.txt")).toBe("/C:/Users/test/file%20with%20spaces.txt")
    expect(encodeFilePath("src\\app.ts")).toBe("src/app.ts")
  })
})
