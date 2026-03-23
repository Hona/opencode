import { describe, expect, test } from "bun:test"
import { dlopen, ptr } from "bun:ffi"
import fs from "fs/promises"
import path from "path"
import { Path } from "../../src/path/path"
import { tmpdir } from "../fixture/fixture"

const k32 =
  process.platform === "win32"
    ? dlopen("kernel32.dll", {
        GetShortPathNameW: { args: ["ptr", "ptr", "u32"], returns: "u32" },
      })
    : undefined

const wide = (input: string) => Buffer.from(input + "\0", "utf16le")

const text = (input: Uint16Array) => {
  const end = input.indexOf(0)
  return Buffer.from(input.buffer, input.byteOffset, (end === -1 ? input.length : end) * 2).toString("utf16le")
}

const short = (input: string) => {
  if (!k32) return
  const src = wide(input)
  const out = new Uint16Array(4096)
  const len = k32.symbols.GetShortPathNameW(ptr(src), ptr(out), out.length)
  if (!len) return
  return text(out)
}

describe("path", () => {
  const bash = (input: string) => {
    const drive = input[0].toLowerCase()
    const rest = input.slice(2).replaceAll("\\", "/")
    return `/${drive}${rest}`
  }

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

  test("keeps missing descendants on a chosen symlink route", async () => {
    await using tmp = await tmpdir()

    const real = path.join(tmp.path, "Target")
    await fs.mkdir(real, { recursive: true })
    const alias = path.join(tmp.path, "Alias")
    await fs.symlink(real, alias, process.platform === "win32" ? "junction" : "dir")

    expect(String(Path.stored(path.join(alias, "missing", "child")))).toBe(path.join(alias, "missing", "child"))
    expect(String(Path.stored(path.join(alias, "missing", "child")))).not.toBe(path.join(real, "missing", "child"))
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

    const root = bash(tmp.path)
    const drive = tmp.path[0].toLowerCase()
    const rest = tmp.path.slice(2).replaceAll("\\", "/")

    expect(String(Path.stored(root))).toBe(tmp.path)
    expect(String(Path.stored(`/cygdrive/${drive}${rest}`))).toBe(tmp.path)
    expect(String(Path.stored(`/mnt/${drive}${rest}`))).toBe(tmp.path)
    expect(String(Path.stored(root))).not.toContain("/cygdrive/")
    expect(String(Path.stored(root))).not.toContain(`/mnt/${drive}`)
  })

  test("canonicalizes lowercase drive roots to the stored drive casing", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir()

    const raw = tmp.path.replace(/^[A-Z]:/, (x) => x.toLowerCase())
    expect(String(Path.stored(raw))).toBe(tmp.path)
  })

  test("expands Windows short-name aliases when one exists", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir()

    const raw = short(tmp.path)
    if (!raw || raw === tmp.path) return

    expect(raw).toContain("~")
    expect(String(Path.stored(raw))).toBe(tmp.path)
    expect(String(Path.stored(raw))).not.toContain("~")
  })

  test("preserves UNC routes for network-style paths", () => {
    if (process.platform !== "win32") return
    const dir = "\\\\server\\share\\Repo\\folder"
    expect(String(Path.stored(dir))).toBe(dir)
  })
})
