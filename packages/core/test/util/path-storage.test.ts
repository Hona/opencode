import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs"
import { execFileSync } from "child_process"
import os from "os"
import path from "path"
import * as PathStorage from "@opencode-ai/core/util/path-storage"

type Expect<T extends true> = T
type _AbsolutePathName = Expect<ReturnType<typeof PathStorage.absolute> extends PathStorage.AbsolutePath ? true : false>
type _RelativePathName = Expect<ReturnType<typeof PathStorage.relative> extends PathStorage.RelativePath ? true : false>
type _PathName = Expect<ReturnType<typeof PathStorage.path> extends PathStorage.Path ? true : false>

describe("PathStorage", () => {
  test("keeps POSIX paths byte-for-byte", () => {
    if (process.platform === "win32") return

    expect(String(PathStorage.absolute("/tmp/foo\\bar"))).toBe("/tmp/foo\\bar")
    expect(String(PathStorage.relative("src\\file.ts"))).toBe("src\\file.ts")
    expect(String(PathStorage.relative("C:\\Repo\\project"))).toBe("C:\\Repo\\project")
    expect(() => PathStorage.absolute("C:/Repo/project")).toThrow()
    expect(PathStorage.toPlatform(PathStorage.absolute("/tmp/foo\\bar"))).toBe("/tmp/foo\\bar")
  })

  test("converts only Windows separators", () => {
    if (process.platform !== "win32") return

    expect(String(PathStorage.absolute("Z:\\Thing"))).toBe("Z:/Thing")
    expect(String(PathStorage.absolute("C:\\Repo\\.\\Thing\\"))).toBe("C:/Repo/./Thing/")
    expect(String(PathStorage.absolute("\\\\server\\share\\Thing"))).toBe("//server/share/Thing")
    expect(String(PathStorage.relative("packages\\api"))).toBe("packages/api")
    expect(String(PathStorage.path("packages\\api"))).toBe("packages/api")
    expect(String(PathStorage.path("D:\\Repo"))).toBe("D:/Repo")
    expect(PathStorage.toPlatform(PathStorage.absolute("Z:\\Thing"))).toBe("Z:\\Thing")
    expect(PathStorage.toPlatform(PathStorage.absolute("\\\\server\\share\\Thing"))).toBe("\\\\server\\share\\Thing")
  })

  test("preserves the '/' worktree sentinel on every platform", () => {
    // Global/non-git projects store "/" as a sentinel and instance-context checks
    // `worktree === "/"`. It must never throw or get rewritten to a backslash.
    expect(String(PathStorage.absolute("/"))).toBe("/")
    expect(PathStorage.toPlatform(PathStorage.absolute("/"))).toBe("/")
    expect(String(PathStorage.path(""))).toBe("")
  })

  test("rejects paths that do not match the requested storage form", () => {
    if (process.platform === "win32") {
      expect(() => PathStorage.absolute("packages\\api")).toThrow()
      expect(() => PathStorage.relative("C:\\Repo")).toThrow()
      expect(() => PathStorage.relative("\\\\server\\share\\Thing")).toThrow()
      return
    }

    expect(() => PathStorage.absolute("src/file.ts")).toThrow()
    expect(() => PathStorage.relative("/tmp/file.ts")).toThrow()
  })

  test("does not resolve Windows junctions", () => {
    if (process.platform !== "win32") return

    const root = mkdtempSync(path.join(os.tmpdir(), "opencode-path-storage-"))
    try {
      const target = path.join(root, "target")
      const child = path.join(target, "child")
      const junction = path.join(root, "junction")
      mkdirSync(child, { recursive: true })
      symlinkSync(target, junction, "junction")

      const visible = path.join(junction, "child")
      expect(String(PathStorage.absolute(visible))).toBe(visible.replaceAll("\\", "/"))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("does not resolve Windows drive aliases", () => {
    if (process.platform !== "win32") return

    const drive = Array.from("ZYXWVUTSRQPONM").find((letter) => !existsSync(`${letter}:\\`))
    if (!drive) return

    const root = mkdtempSync(path.join(os.tmpdir(), "opencode-path-storage-"))
    try {
      mkdirSync(path.join(root, "child"), { recursive: true })
      execFileSync("subst", [`${drive}:`, root], { stdio: "ignore" })

      expect(String(PathStorage.absolute(`${drive}:\\child`))).toBe(`${drive}:/child`)
    } finally {
      try {
        execFileSync("subst", [`${drive}:`, "/D"], { stdio: "ignore" })
      } catch {}
      rmSync(root, { recursive: true, force: true })
    }
  })
})
