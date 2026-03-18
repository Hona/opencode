import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"
import path from "path"

import { Config } from "../../src/config/config"
import { Path } from "../../src/path/path"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

let roots: string[] = []
let calls: string[] = []
let opens: string[] = []
let getSpy: ReturnType<typeof spyOn> | undefined

mock.module("../../src/lsp/server", () => ({
  LSPServer: {
    Fake: {
      id: "fake",
      extensions: [".ts"],
      root: async (file: string) => (path.basename(file) === "first.ts" ? roots[0] : roots[1]),
      spawn: async () => ({
        process: {
          pid: 1,
          kill() {},
        },
      }),
    },
  },
}))

mock.module("../../src/lsp/client", () => ({
  LSPClient: {
    create: async (input: { serverID: string; root: string }) => {
      calls.push(input.root)
      return {
        root: input.root,
        rootKey: String(Path.key(input.root)),
        serverID: input.serverID,
        connection: {
          sendRequest: async () => null,
        },
        notify: {
          open: async (input: { path: string }) => {
            opens.push(input.path)
          },
        },
        diagnostics: new Map(),
        waitForDiagnostics: async () => {},
        shutdown: async () => {},
      }
    },
  },
}))

const { LSP } = await import("../../src/lsp/index")

beforeEach(() => {
  getSpy = spyOn(Config, "get").mockResolvedValue({})
})

afterEach(async () => {
  roots = []
  calls = []
  opens = []
  getSpy?.mockRestore()
  getSpy = undefined
  await Instance.disposeAll()
})

test("reuses clients for equivalent roots", async () => {
  if (process.platform !== "win32") return
  await using tmp = await tmpdir()

  roots = [tmp.path, tmp.path.toLowerCase().replaceAll("\\", "/")]

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await LSP.touchFile(path.join(tmp.path, "first.ts"))
      await LSP.touchFile(path.join(roots[1], "second.ts"))
    },
  })

  expect(calls).toHaveLength(1)
  expect(String(Path.key(calls[0]!))).toBe(String(Path.key(tmp.path)))
  expect(opens).toHaveLength(2)
})
