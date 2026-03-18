import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

import { Path } from "../../src/path/path"
import { tmpdir } from "../fixture/fixture"

describe("path", () => {
  describe("pretty()", () => {
    const win = { cwd: "C:\\work", platform: "win32" as const }

    for (const [name, input] of [
      ["slash drive", "/c/tmp/file.txt"],
      ["slash drive with colon", "/C:/tmp/file.txt"],
      ["cygdrive", "/cygdrive/c/tmp/file.txt"],
      ["wsl", "/mnt/c/tmp/file.txt"],
      ["file uri", "file:///C:/tmp/file.txt"],
    ]) {
      test(`normalizes ${name} on Windows`, () => {
        expect(String(Path.pretty(input, win))).toBe("C:\\tmp\\file.txt")
      })
    }

    test("normalizes relative input to native absolute form", () => {
      expect(String(Path.pretty("src/../file.ts", { cwd: "/repo", platform: "linux" }))).toBe("/repo/file.ts")
    })
  })

  describe("key()", () => {
    test("matches slash and case variants on Windows", () => {
      const a = Path.key("C:\\Repo\\File.ts", { platform: "win32" })
      const b = Path.key("c:/repo/file.ts", { platform: "win32" })
      expect(a).toBe(b)
      expect(Path.eq("C:\\Repo\\File.ts", "c:/repo/file.ts", { platform: "win32" })).toBe(true)
      expect(Path.match("C:\\Repo\\File.ts", b, { platform: "win32" })).toBe(true)
    })
  })

  describe("uri()", () => {
    test("round-trips POSIX file URIs", () => {
      const file = "/tmp/dir/a b.txt"
      const uri = Path.uri(file, { platform: "linux" })
      expect(String(uri)).toBe("file:///tmp/dir/a%20b.txt")
      expect(String(Path.fromURI(uri, { platform: "linux" }))).toBe(file)
    })

    test("round-trips Windows file URIs", () => {
      const file = "C:\\tmp\\dir\\a b.txt"
      const uri = Path.uri(file, { platform: "win32" })
      expect(String(uri)).toBe("file:///C:/tmp/dir/a%20b.txt")
      expect(String(Path.fromURI(uri, { platform: "win32" }))).toBe(file)
    })
  })

  describe("posix()", () => {
    test("converts Windows pretty paths to forward slashes", () => {
      expect(String(Path.posix("C:\\tmp\\dir\\file.txt", { platform: "win32" }))).toBe("C:/tmp/dir/file.txt")
    })

    test("keeps POSIX absolute paths stable", () => {
      expect(String(Path.posix("/tmp/dir/file.txt", { platform: "linux" }))).toBe("/tmp/dir/file.txt")
    })
  })

  describe("rel()", () => {
    test("returns branded relative paths", () => {
      expect(String(Path.rel("/repo", "/repo/src/file.ts", { platform: "linux" }))).toBe("src/file.ts")
    })
  })

  describe("truecase()", () => {
    test("keeps missing tails as typed on Windows", async () => {
      if (process.platform !== "win32") return
      await using tmp = await tmpdir()

      const dir = path.join(tmp.path, "CaseDir")
      const child = path.join(dir, "Leaf")
      await fs.mkdir(child, { recursive: true })

      const input = path.join(tmp.path.toLowerCase(), "casedir", "leaf", "Miss", "Tail.ts")
      const result = String(await Path.truecase(input))

      expect(result).toBe(path.join(tmp.path, "CaseDir", "Leaf", "Miss", "Tail.ts"))
    })

    test("preserves alias roots while true-casing Windows paths", async () => {
      if (process.platform !== "win32") return
      await using tmp = await tmpdir()

      const real = path.join(tmp.path, "Target")
      await fs.mkdir(path.join(real, "Leaf"), { recursive: true })
      const alias = path.join(tmp.path, "Alias")
      await fs.symlink(real, alias, "junction")

      const input = path.join(tmp.path.toLowerCase(), "alias", "leaf")
      const result = String(await Path.truecase(input))

      expect(result).toBe(path.join(tmp.path, "Alias", "Leaf"))
    })

    test("is a no-op off Windows", async () => {
      const file = "/tmp/test.txt"
      expect(String(await Path.truecase(file, { platform: "linux" }))).toBe(file)
    })
  })
})
