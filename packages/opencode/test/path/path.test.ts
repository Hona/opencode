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

  test("resolves Windows alias roots for stored paths", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir()

    const real = path.join(tmp.path, "Target")
    await fs.mkdir(real, { recursive: true })
    const alias = path.join(tmp.path, "Alias")
    await fs.symlink(real, alias, "junction")

    expect(Path.stored(alias)).toBe(Path.stored(real))
  })
})
