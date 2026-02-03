import { describe, expect, test, mock } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

mock.module("../../src/lsp/server", () => ({
  LSPServer: {
    Bad: {
      id: "bad",
      extensions: [".txt"],
      root: async () => path.join(process.cwd(), "__missing_root__"),
      spawn: async () => undefined,
    },
  },
}))

describe("LSP root validation", () => {
  test("skips servers with invalid roots", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.txt"), "hello")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { LSP } = await import("../../src/lsp")
        const file = path.join(tmp.path, "a.txt")
        const available = await LSP.hasClients(file)
        expect(available).toBe(false)
      },
    })
  })
})
