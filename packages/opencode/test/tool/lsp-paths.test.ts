import { describe, expect, test } from "bun:test"
import nodePath from "node:path"
import { toPosix } from "@opencode-ai/util/path"
import { LspTool } from "../../src/tool/lsp"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const isWin = process.platform === "win32"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.lsp path normalization", () => {
  if (!isWin) return

  test("windows: accepts MSYS-style absolute file paths", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        lsp: false,
      },
      init: async (dir) => {
        await Bun.write(nodePath.join(dir, "a.ts"), "export const x = 1\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lsp = await LspTool.init()
        const msysDir = toPosix(tmp.path).replace(/^([a-zA-Z]):\//, (_, d) => `/${d.toLowerCase()}/`)
        const inputPath = `${msysDir}/a.ts`

        await expect(
          lsp.execute({ operation: "hover", filePath: inputPath, line: 1, character: 1 }, ctx),
        ).rejects.toThrow("No LSP server available")
      },
    })
  })
})
