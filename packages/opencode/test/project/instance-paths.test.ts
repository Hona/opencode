import { describe, expect, test } from "bun:test"
import { toPosix } from "@opencode-ai/util/path"
import { realpathSync } from "node:fs"
import os from "node:os"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("Instance directory normalization", () => {
  if (process.platform !== "win32") return

  test("canonicalizes short and long paths to same directory", async () => {
    await using tmp = await tmpdir({ git: true })

    const longRoot = toPosix(realpathSync.native(os.tmpdir()))
    const shortRoot = toPosix(os.tmpdir())
    const long = toPosix(tmp.path)
    expect(long.startsWith(longRoot)).toBe(true)

    const suffix = long.slice(longRoot.length)
    const short = toPosix(shortRoot + suffix)

    const dir1 = await Instance.provide({
      directory: long,
      fn: async () => Instance.directory,
    })
    const dir2 = await Instance.provide({
      directory: short,
      fn: async () => Instance.directory,
    })

    expect(dir1).toBe(dir2)
    expect(dir1).not.toContain("\\")
  })
})
