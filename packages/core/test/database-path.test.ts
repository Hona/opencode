import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs"
import { execFileSync } from "child_process"
import os from "os"
import path from "path"
import * as DatabasePath from "@opencode-ai/core/database/path"

describe("DatabasePath", () => {
  test("keeps POSIX paths byte-for-byte", () => {
    if (process.platform === "win32") return

    expect(DatabasePath.pattern("/tmp/foo\\bar")).toBe("/tmp/foo\\bar")
    expect(DatabasePath.pattern("src\\file.ts")).toBe("src\\file.ts")
    expect(DatabasePath.pattern("C:\\Repo\\project")).toBe("C:\\Repo\\project")
  })

  test("converts only Windows separators", () => {
    if (process.platform !== "win32") return

    expect(DatabasePath.pattern("packages\\api")).toBe("packages/api")
    expect(DatabasePath.pattern("D:\\Repo")).toBe("D:/Repo")
  })

  test("preserves the '/' worktree sentinel on every platform", () => {
    // Global/non-git projects store "/" as a sentinel and instance-context checks
    // `worktree === "/"`. It must never throw or get rewritten to a backslash.
    expect(DatabasePath.pattern("/")).toBe("/")
    expect(DatabasePath.pattern("")).toBe("")
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
      expect(DatabasePath.pattern(visible)).toBe(visible.replaceAll("\\", "/"))
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

      expect(DatabasePath.pattern(`${drive}:\\child`)).toBe(`${drive}:/child`)
    } finally {
      try {
        execFileSync("subst", [`${drive}:`, "/D"], { stdio: "ignore" })
      } catch {}
      rmSync(root, { recursive: true, force: true })
    }
  })
})
