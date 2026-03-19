import { describe, expect, test } from "bun:test"
import { createPathHelpers, dedupeFilePaths, filePathEqual, filePathKey, isFileTab } from "./path"

describe("file path helpers", () => {
  test("normalizes file inputs against workspace root", () => {
    const path = createPathHelpers(() => "/repo")
    expect(path.normalize("file:///repo/src/app.ts?x=1#h")).toBe("src/app.ts")
    expect(path.normalize("/repo/src/app.ts")).toBe("src/app.ts")
    expect(path.normalize("./src/app.ts")).toBe("src/app.ts")
    expect(path.normalizeDir("src/components///")).toBe("src/components")
    expect(path.tab("src/app.ts")).toBe("tab:file:src/app.ts")
    expect(isFileTab(path.tab("src/app.ts"))).toBe(true)
    expect(isFileTab("file:///repo/src/app.ts")).toBe(false)
    expect(path.normalizeTab("file://src/app.ts")).toBe("tab:file:src/app.ts")
    expect(path.normalizeTab("tab:file:src/app.ts")).toBe("tab:file:src/app.ts")
    expect(path.normalizeTab("file:///repo/src/app.ts")).toBe("file:///repo/src/app.ts")
    expect(path.normalizeTab("review")).toBe("review")
    expect(path.pathFromTab("tab:file:src/app.ts")).toBe("src/app.ts")
    expect(path.pathFromTab("file://src/app.ts")).toBe("src/app.ts")
    expect(path.pathFromTab("file:///repo/src/app.ts")).toBeUndefined()
    expect(path.pathFromTab("other://src/app.ts")).toBeUndefined()
  })

  test("normalizes Windows absolute paths with mixed separators", () => {
    const path = createPathHelpers(() => "C:\\repo")
    expect(path.normalize("C:\\repo\\src\\app.ts")).toBe("src\\app.ts")
    expect(path.normalize("C:/repo/src/app.ts")).toBe("src/app.ts")
    expect(path.normalize("file://C:/repo/src/app.ts")).toBe("src/app.ts")
    expect(path.normalize("c:\\repo\\src\\app.ts")).toBe("src\\app.ts")
  })

  test("renders display paths with native separators", () => {
    const posix = createPathHelpers(() => "/repo")
    expect(posix.display("tab:file:src/app.ts")).toBe("src/app.ts")

    const win = createPathHelpers(() => "C:\\repo")
    expect(win.display("src/app.ts")).toBe("src\\app.ts")
    expect(win.display("file://src/app.ts")).toBe("src\\app.ts")
    expect(win.display("tab:file:src/app.ts")).toBe("src\\app.ts")
    expect(win.display("C:/repo/src/app.ts")).toBe("src\\app.ts")
    expect(win.display("src/app/")).toBe("src\\app\\")
  })

  test("normalizes app file keys across slash variants", () => {
    expect(String(filePathKey("src\\app.ts"))).toBe("src/app.ts")
    expect(filePathEqual("src\\app.ts", "src/app.ts")).toBe(true)
    expect(dedupeFilePaths(["src\\app.ts", "src/app.ts", "src/util.ts"])).toEqual(["src/app.ts", "src/util.ts"])
  })
})
