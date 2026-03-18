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

  describe("contains()", () => {
    test("matches slash and case variants on Windows", () => {
      expect(Path.contains("C:\\Repo", "c:/repo/src/file.ts", { platform: "win32" })).toBe(true)
    })

    test("rejects absolute-relative path mixes", () => {
      expect(Path.contains("/repo", "repo/src/file.ts", { platform: "linux" })).toBe(false)
      expect(Path.contains("repo", "/repo/src/file.ts", { platform: "linux" })).toBe(false)
    })
  })

  describe("externalGlob()", () => {
    test("normalizes Windows directory globs", () => {
      expect(Path.externalGlob("C:\\Users\\Dev\\tmp\\", { platform: "win32" })).toBe("C:/Users/Dev/tmp/*")
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

  describe("expand()", () => {
    test("expands home aliases with test home semantics", () => {
      const home = process.env.OPENCODE_TEST_HOME!
      expect(String(Path.expand("~"))).toBe(home)
      expect(String(Path.expand("~/repo/file.ts"))).toBe(path.join(home, "repo", "file.ts"))
      expect(String(Path.expand("$HOME/repo/file.ts"))).toBe(path.join(home, "repo", "file.ts"))
      expect(String(Path.expand("repo/file.ts"))).toBe("repo/file.ts")
    })
  })

  describe("display()", () => {
    test("shortens home paths by default", () => {
      const home = process.env.OPENCODE_TEST_HOME!
      expect(Path.display(path.join(home, "repo", "file.ts"))).toBe(`~${path.sep}repo${path.sep}file.ts`)
    })

    test("prefers cwd-relative output inside cwd", () => {
      expect(Path.display("/repo/src/file.ts", { cwd: "/repo", home: "/repo", platform: "linux", relative: true })).toBe(
        "src/file.ts",
      )
    })

    test("can skip home shortening", () => {
      const home = process.env.OPENCODE_TEST_HOME!
      expect(Path.display(path.join(home, "repo", "file.ts"), { home: false })).toBe(path.join(home, "repo", "file.ts"))
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

  describe("physical()", () => {
    test("resolves symlink roots while keeping missing tails", async () => {
      await using tmp = await tmpdir()
      const target = path.join(tmp.path, "real")
      await fs.mkdir(target)
      const link = path.join(tmp.path, "alias")
      await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir")

      const result = String(await Path.physical(path.join(link, "child", "file.txt")))
      expect(result).toBe(path.join(target, "child", "file.txt"))
    })
  })

  describe("truecaseSync()", () => {
    test("keeps missing tails as typed on Windows", async () => {
      if (process.platform !== "win32") return
      await using tmp = await tmpdir()

      const dir = path.join(tmp.path, "CaseDir")
      const child = path.join(dir, "Leaf")
      await fs.mkdir(child, { recursive: true })

      const input = path.join(tmp.path.toLowerCase(), "casedir", "leaf", "Miss", "Tail.ts")
      const result = String(Path.truecaseSync(input))

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
      const result = String(Path.truecaseSync(input))

      expect(result).toBe(path.join(tmp.path, "Alias", "Leaf"))
    })

    test("is a no-op off Windows", () => {
      const file = "/tmp/test.txt"
      expect(String(Path.truecaseSync(file, { platform: "linux" }))).toBe(file)
    })
  })
})
