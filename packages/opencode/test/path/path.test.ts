import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

import { Path } from "../../src/path/path"
import { tmpdir } from "../fixture/fixture"
import { win as alias } from "../lib/windows-path"

describe("path", () => {
  describe("pretty()", () => {
    const opts = { cwd: "C:\\work", platform: "win32" as const }

    for (const [name, input] of [
      ["slash drive", "/c/tmp/file.txt"],
      ["slash drive with colon", "/C:/tmp/file.txt"],
      ["cygdrive", "/cygdrive/c/tmp/file.txt"],
      ["wsl", "/mnt/c/tmp/file.txt"],
      ["file uri", "file:///C:/tmp/file.txt"],
    ]) {
      test(`normalizes ${name} on Windows`, () => {
        expect(String(Path.pretty(input, opts))).toBe("C:\\tmp\\file.txt")
      })
    }

    test("normalizes relative input to native absolute form", () => {
      expect(String(Path.pretty("src/../file.ts", { cwd: "/repo", platform: "linux" }))).toBe("/repo/file.ts")
    })

    test("collapses Windows alias forms to the same pretty path", () => {
      const file = "C:\\Users\\Dev\\tmp\\file.txt"
      for (const item of alias(file)) {
        expect(String(Path.pretty(item.path, { platform: "win32" }))).toBe(file)
      }
    })

    test("normalizes Windows UNC alias forms", () => {
      const file = "\\\\server\\share\\tmp\\file.txt"
      for (const input of [file, "//server/share/tmp/file.txt", "file://server/share/tmp/file.txt"]) {
        expect(String(Path.pretty(input, { platform: "win32" }))).toBe(file)
      }
    })

    test("treats localhost file URIs as local files", () => {
      expect(String(Path.pretty("file://localhost/C:/tmp/file.txt", { platform: "win32" }))).toBe("C:\\tmp\\file.txt")
      expect(String(Path.pretty("file://localhost/tmp/file.txt", { platform: "linux" }))).toBe("/tmp/file.txt")
    })
  })

  describe("isAbsolute()", () => {
    test("treats file URIs as absolute", () => {
      expect(Path.isAbsolute("file:///tmp/dir/file.txt", { platform: "linux" })).toBe(true)
      expect(Path.isAbsolute("file:///C:/tmp/file.txt", { platform: "win32" })).toBe(true)
    })

    test("matches all Windows alias roots", () => {
      for (const item of alias("C:\\Users\\Dev\\tmp\\file.txt")) {
        expect(Path.isAbsolute(item.path, { platform: "win32" })).toBe(true)
      }
    })

    test("treats UNC paths as absolute on Windows", () => {
      expect(Path.isAbsolute("\\\\server\\share\\repo", { platform: "win32" })).toBe(true)
      expect(Path.isAbsolute("//server/share/repo", { platform: "win32" })).toBe(true)
      expect(Path.isAbsolute("file://server/share/repo", { platform: "win32" })).toBe(true)
    })

    test("keeps relative inputs relative", () => {
      expect(Path.isAbsolute("src/file.ts", { platform: "linux" })).toBe(false)
      expect(Path.isAbsolute("src/file.ts", { platform: "win32" })).toBe(false)
    })
  })

  describe("key()", () => {
    test("keeps the global slash sentinel stable", () => {
      expect(String(Path.key("/"))).toBe("/")
      expect(Path.eq("/", "/")).toBe(true)
      expect(Path.eq("/", process.platform === "win32" ? "C:\\" : "/tmp")).toBe(false)
    })

    test("matches slash and case variants on Windows", () => {
      const a = Path.key("C:\\Repo\\File.ts", { platform: "win32" })
      const b = Path.key("c:/repo/file.ts", { platform: "win32" })
      expect(a).toBe(b)
      expect(Path.eq("C:\\Repo\\File.ts", "c:/repo/file.ts", { platform: "win32" })).toBe(true)
      expect(Path.match("C:\\Repo\\File.ts", b, { platform: "win32" })).toBe(true)
    })

    test("matches all Windows alias forms", () => {
      const [head, ...tail] = alias("C:\\Users\\Dev\\tmp\\file.txt")
      const key = Path.key(head.path, { platform: "win32" })
      for (const item of tail) {
        expect(Path.key(item.path, { platform: "win32" })).toBe(key)
        expect(Path.eq(head.path, item.path, { platform: "win32" })).toBe(true)
        expect(Path.match(item.path, key, { platform: "win32" })).toBe(true)
      }
    })

    test("matches UNC alias forms on Windows", () => {
      const file = "\\\\server\\share\\tmp\\file.txt"
      const key = Path.key(file, { platform: "win32" })
      for (const input of ["//server/share/tmp/file.txt", "file://server/share/tmp/file.txt"]) {
        expect(Path.key(input, { platform: "win32" })).toBe(key)
        expect(Path.eq(file, input, { platform: "win32" })).toBe(true)
        expect(Path.match(input, key, { platform: "win32" })).toBe(true)
      }
    })
  })

  describe("contains()", () => {
    test("matches slash and case variants on Windows", () => {
      expect(Path.contains("C:\\Repo", "c:/repo/src/file.ts", { platform: "win32" })).toBe(true)
    })

    test("matches all Windows alias parent and child forms", () => {
      const dirs = alias("C:\\Users\\Dev\\tmp")
      const files = alias("C:\\Users\\Dev\\tmp\\file.txt")
      for (const dir of dirs) {
        for (const file of files) {
          expect(Path.contains(dir.path, file.path, { platform: "win32" })).toBe(true)
        }
      }
    })

    test("matches UNC parents across alias forms on Windows", () => {
      const dir = "\\\\server\\share\\repo"
      for (const file of ["//server/share/repo/src/file.ts", "file://server/share/repo/src/file.ts"]) {
        expect(Path.contains(dir, file, { platform: "win32" })).toBe(true)
      }
    })

    test("rejects Windows cross-drive and cross-share mixes", () => {
      expect(Path.contains("C:\\repo", "D:\\repo\\file.ts", { platform: "win32" })).toBe(false)
      expect(Path.contains("\\\\server\\share\\repo", "\\\\server\\other\\repo\\file.ts", { platform: "win32" })).toBe(false)
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

    test("canonicalizes all Windows alias roots", () => {
      for (const item of alias("C:\\Users\\Dev\\tmp")) {
        expect(Path.externalGlob(item.path, { platform: "win32" })).toBe("C:/Users/Dev/tmp/*")
      }
    })

    test("normalizes UNC directory globs", () => {
      expect(Path.externalGlob("\\\\server\\share\\tmp\\", { platform: "win32" })).toBe("//server/share/tmp/*")
    })
  })

  describe("canonical()", () => {
    test("leaves non-path patterns alone", () => {
      expect(Path.canonical("*", { platform: "win32" })).toBe("*")
      expect(Path.canonical("src/*", { platform: "win32" })).toBe("src/*")
    })

    test("canonicalizes Windows alias paths to posix form", () => {
      for (const item of alias("C:\\Users\\Dev\\tmp\\file.txt")) {
        expect(Path.canonical(item.path, { platform: "win32" })).toBe("C:/Users/Dev/tmp/file.txt")
        expect(Path.canonical(item.glob, { platform: "win32" })).toBe("C:/Users/Dev/tmp/file.txt/*")
      }
    })

    test("canonicalizes UNC alias paths to posix form", () => {
      expect(Path.canonical("\\\\server\\share\\tmp\\file.txt", { platform: "win32" })).toBe("//server/share/tmp/file.txt")
      expect(Path.canonical("file://server/share/tmp/file.txt", { platform: "win32" })).toBe("//server/share/tmp/file.txt")
    })
  })

  describe("guess()", () => {
    test("detects remote Windows roots across slash variants", () => {
      expect(Path.guess("C:\\repo\\file.ts")).toBe("win32")
      expect(Path.guess("\\\\server\\share\\repo")).toBe("win32")
      expect(Path.guess("/mnt/c/repo/file.ts")).toBe("win32")
      expect(Path.guess("/srv/repo/file.ts")).toBe("linux")
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

    test("round-trips Windows UNC file URIs", () => {
      const file = "\\\\server\\share\\tmp\\a b.txt"
      const uri = Path.uri(file, { platform: "win32" })
      expect(String(uri)).toBe("file://server/share/tmp/a%20b.txt")
      expect(String(Path.fromURI(uri, { platform: "win32" }))).toBe(file)
    })

    test("resolves repo-relative Windows paths with Windows URI rules", () => {
      expect(String(Path.uri("src/file.ts", { cwd: "C:\\repo", platform: "windows" }))).toBe("file:///C:/repo/src/file.ts")
    })

    test("preserves undecodable URI segments", () => {
      expect(String(Path.fromURI("file:///tmp/%ZZ/file.txt", { platform: "linux" }))).toBe("/tmp/%ZZ/file.txt")
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

    test("falls back to the absolute target across Windows drives", () => {
      expect(String(Path.rel("C:\\repo", "D:\\repo\\file.ts", { platform: "win32" }))).toBe("D:\\repo\\file.ts")
    })
  })

  describe("repo()", () => {
    test("normalizes repo keys to forward slashes", () => {
      expect(String(Path.repo("src\\nested\\file.ts"))).toBe("src/nested/file.ts")
      expect(String(Path.repo("./src//nested/"))).toBe("src/nested/")
    })

    test("preserves directory markers", () => {
      expect(Path.repoIsDir("src\\nested\\")).toBe(true)
      expect(Path.repoIsDir("src\\nested")).toBe(false)
    })
  })

  describe("repoParent()", () => {
    test("returns repo parents with root dot", () => {
      expect(String(Path.repoParent("src\\nested\\file.ts"))).toBe("src/nested")
      expect(String(Path.repoParent("src\\nested\\"))).toBe("src")
      expect(String(Path.repoParent("file.ts"))).toBe(".")
    })
  })

  describe("repoName()", () => {
    test("returns repo basenames for files and directories", () => {
      expect(Path.repoName("src\\nested\\file.ts")).toBe("file.ts")
      expect(Path.repoName("src\\nested\\")).toBe("nested")
    })
  })

  describe("repoDepth()", () => {
    test("counts repo path segments", () => {
      expect(Path.repoDepth("src\\nested\\file.ts")).toBe(3)
      expect(Path.repoDepth("src\\nested\\")).toBe(2)
      expect(Path.repoDepth(".")).toBe(0)
    })
  })

  describe("hidden()", () => {
    test("detects hidden segments across slash variants", () => {
      expect(Path.hidden(".env")).toBe(true)
      expect(Path.hidden("src/.git/config")).toBe(true)
      expect(Path.hidden("src/.")).toBe(true)
      expect(Path.hidden("src\\.cache\\tmp")).toBe(true)
      expect(Path.hidden("src/visible/file.ts")).toBe(false)
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

  describe("join()", () => {
    test("joins child paths against an existing pretty root", () => {
      expect(String(Path.join("/repo", "src/file.ts", { platform: "linux" }))).toBe("/repo/src/file.ts")
    })
  })

  describe("parent()", () => {
    test("returns the normalized parent directory", () => {
      expect(String(Path.parent("/repo/src/file.ts", { platform: "linux" }))).toBe("/repo/src")
    })
  })

  describe("repoFrom()", () => {
    test("converts absolute paths back into repo paths", () => {
      expect(String(Path.repoFrom("/repo", "/repo/src/file.ts", { platform: "linux" }))).toBe("src/file.ts")
    })
  })

  describe("up()", () => {
    test("walks to the bounded ancestor inclusively", () => {
      expect(Array.from(Path.up("/repo/src/nested", { stop: "/repo", platform: "linux" }), String)).toEqual([
        "/repo/src/nested",
        "/repo/src",
        "/repo",
      ])
    })

    test("returns nothing when start is outside the bound", () => {
      expect(Array.from(Path.up("/repo-other/src", { stop: "/repo", platform: "linux" }), String)).toEqual([])
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
    test("keeps the global slash sentinel stable", () => {
      expect(String(Path.truecaseSync("/"))).toBe("/")
    })

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
