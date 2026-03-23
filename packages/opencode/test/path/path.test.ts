import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Path } from "../../src/path/path"
import { tmpdir } from "../fixture/fixture"

const alias = (input: string) =>
  input
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((part) => /^[^ .\\/]{1,6}~\d(?:\.[^ .\\/]{0,3})?$/i.test(part))

describe("path", () => {
  test("keeps sentinel storage paths unchanged", () => {
    expect(String(Path.stored(""))).toBe("")
    expect(String(Path.stored("/"))).toBe("/")
  })

  test("keeps missing paths on the chosen route", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "missing", "child")
    expect(String(Path.stored(dir))).toBe(path.resolve(dir))
  })

  test("preserves symlink routes in stored paths", async () => {
    await using tmp = await tmpdir()

    const real = path.join(tmp.path, "Target")
    await fs.mkdir(real, { recursive: true })
    await fs.mkdir(path.join(real, "Leaf"), { recursive: true })
    const alias = path.join(tmp.path, "Alias")
    await fs.symlink(real, alias, process.platform === "win32" ? "junction" : "dir")

    expect(String(Path.stored(alias))).toBe(alias)
    expect(String(Path.stored(path.join(alias, "Leaf")))).toBe(path.join(alias, "Leaf"))
    expect(String(Path.stored(alias))).not.toBe(real)
    expect(String(Path.stored(path.join(alias, "Leaf")))).not.toBe(path.join(real, "Leaf"))
  })

  test("keeps native posix routes without introducing Windows key forms", async () => {
    if (process.platform === "win32") return
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "Thing")
    await fs.mkdir(dir, { recursive: true })

    expect(String(Path.stored(dir))).toBe(dir)
    expect(String(Path.stored(dir))).not.toContain("\\")
  })

  test("normalizes Windows bash-style paths to native routes", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir()

    const drive = tmp.path[0].toLowerCase()
    const rest = tmp.path.slice(2).replaceAll("\\", "/")

    expect(String(Path.stored(`/${drive}${rest}`))).toBe(tmp.path)
    expect(String(Path.stored(`/cygdrive/${drive}${rest}`))).toBe(tmp.path)
    expect(String(Path.stored(`/mnt/${drive}${rest}`))).toBe(tmp.path)
    expect(String(Path.stored(`/${drive}${rest}`))).not.toContain("/cygdrive/")
    expect(String(Path.stored(`/${drive}${rest}`))).not.toContain(`/mnt/${drive}`)
  })

  test("preserves UNC routes for network-style paths", () => {
    if (process.platform !== "win32") return
    const dir = "\\\\server\\share\\Repo\\folder"
    expect(String(Path.stored(dir))).toBe(dir)
    expect(alias(String(Path.stored(dir)))).toBe(false)
  })
})
