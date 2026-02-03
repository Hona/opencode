import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("pty.create", () => {
  test("throws for invalid cwd", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Pty.create({ cwd: path.join(tmp.path, "missing") })).rejects.toThrow("Invalid cwd")
      },
    })
  })
})
