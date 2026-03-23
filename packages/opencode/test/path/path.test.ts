import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Path } from "../../src/path/path"
import { tmpdir } from "../fixture/fixture"

describe("path", () => {
  test("keeps sentinel storage paths unchanged", () => {
    expect(String(Path.stored(""))).toBe("")
    expect(String(Path.stored("/"))).toBe("/")
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
  })
})
