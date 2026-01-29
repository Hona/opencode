import { describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { Filesystem } from "../../src/util/filesystem"
import { toPosix } from "@opencode-ai/util/path"

const isWin = process.platform === "win32"

describe("util.filesystem", () => {
  test("exists() is true for files and directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir")
    const file = path.join(tmp, "file.txt")
    const missing = path.join(tmp, "missing")

    await mkdir(dir, { recursive: true })
    await Bun.write(file, "hello")

    const cases = await Promise.all([Filesystem.exists(dir), Filesystem.exists(file), Filesystem.exists(missing)])

    expect(cases).toEqual([true, true, false])

    await rm(tmp, { recursive: true, force: true })
  })

  test("isDir() is true only for directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir")
    const file = path.join(tmp, "file.txt")
    const missing = path.join(tmp, "missing")

    await mkdir(dir, { recursive: true })
    await Bun.write(file, "hello")

    const cases = await Promise.all([Filesystem.isDir(dir), Filesystem.isDir(file), Filesystem.isDir(missing)])

    expect(cases).toEqual([true, false, false])

    await rm(tmp, { recursive: true, force: true })
  })

  if (!isWin) return

  test("globUp() returns posix absolute paths on Windows", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-globup-"))
    const root = toPosix(tmp)
    const file = toPosix(path.join(tmp, "foo.txt"))
    const nested = toPosix(path.join(tmp, "sub", "nested"))

    await mkdir(path.join(tmp, "sub", "nested"), { recursive: true })
    await Bun.write(file, "hello")

    const matches = await Filesystem.globUp("*.txt", nested)
    expect(matches.some((x) => x.endsWith("/foo.txt"))).toBe(true)
    expect(matches.some((x) => x.includes("\\"))).toBe(false)

    await rm(root, { recursive: true, force: true })
  })
})
