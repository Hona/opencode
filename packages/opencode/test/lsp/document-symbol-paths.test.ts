import { describe, expect, test, mock } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

let seen: string | undefined

mock.module("../../src/lsp/server", () => ({
  LSPServer: {
    Fake: {
      id: "fake",
      extensions: [".fake"],
      root: async (file: string) => {
        seen = file
        return process.cwd()
      },
      spawn: async () => undefined,
    },
  },
}))

describe("LSP documentSymbol URI path normalization", () => {
  test("windows: converts file:// URI to drive-letter path", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.fake"), "x")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seen = undefined
        const { LSP } = await import("../../src/lsp")
        const uri = pathToFileURL(path.join(tmp.path, "a.fake")).href
        await LSP.documentSymbol(uri)
        expect(seen).toBeTruthy()
        expect(seen!).toMatch(/^[a-zA-Z]:\//)
        expect(seen!).not.toMatch(/^\/[a-zA-Z]:\//)
      },
    })
  })
})
