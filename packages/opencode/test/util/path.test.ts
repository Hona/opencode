import { describe, expect, test } from "bun:test"
import path from "../../src/util/path"

const isWin = process.platform === "win32"

describe("util.path", () => {
  test("normalizes standard paths", () => {
    const input = isWin ? "a\\b\\c" : "a/b/c"
    expect(path.normalize(input)).toBe("a/b/c")
  })

  test("joins with forward slashes", () => {
    expect(path.join("a", "b")).toBe("a/b")
  })

  test("resolve() output contains no backslashes", () => {
    const res = path.resolve(".")
    expect(res).not.toContain("\\")
  })

  if (!isWin) return

  test("converts Git Bash / MSYS paths", () => {
    expect(path.toPosix("/c/Users/Luke")).toBe("C:/Users/Luke")
    expect(path.toPosix("/d/Project")).toBe("D:/Project")
    expect(path.toPosix("/cygdrive/e/src")).toBe("E:/src")
    expect(path.toPosix("/mnt/f/dev")).toBe("F:/dev")
  })

  test("normalize() converts MSYS roots", () => {
    expect(path.normalize("/c/Users/Luke")).toBe("C:/Users/Luke")
  })

  test("normalize() preserves UNC roots", () => {
    expect(path.normalize("\\\\server\\share")).toBe("//server/share")
  })

  test("preserves UNC paths", () => {
    const unc = "\\\\server\\share\\file.txt"
    expect(path.toPosix(unc)).toBe("//server/share/file.txt")
  })

  test("handles mixed slashes", () => {
    expect(path.toPosix("C:/Users/Luke\\dev")).toBe("C:/Users/Luke/dev")
    expect(path.toPosix("c:\\Users\\Luke\\dev")).toBe("C:/Users/Luke/dev")
  })

  test("windows: converts extended-length drive paths", () => {
    expect(path.toPosix("\\\\?\\C:\\Users\\Luke\\file.txt")).toBe("C:/Users/Luke/file.txt")
    expect(path.toPosix("//?/C:/Users/Luke/file.txt")).toBe("C:/Users/Luke/file.txt")
  })

  test("windows: converts extended-length UNC paths", () => {
    expect(path.toPosix("\\\\?\\UNC\\server\\share\\file.txt")).toBe("//server/share/file.txt")
    expect(path.toPosix("//?/UNC/server/share/file.txt")).toBe("//server/share/file.txt")
  })
})
