import { describe, expect, test } from "bun:test"
import nodePath from "node:path"
import { toPosix } from "@opencode-ai/util/path"
import { GlobTool } from "../../src/tool/glob"
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

describe("tool.glob path normalization", () => {
  if (!isWin) return

  test("windows: accepts MSYS-style absolute search paths", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(nodePath.join(dir, "a.ts"), "export const x = 1\n")
        await Bun.write(nodePath.join(dir, "b.js"), "console.log('x')\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const glob = await GlobTool.init()
        const msysDir = toPosix(tmp.path).replace(/^([a-zA-Z]):\//, (_, d) => `/${d.toLowerCase()}/`)
        const result = await glob.execute({ pattern: "*.ts", path: msysDir }, ctx)

        const expected = toPosix(nodePath.join(tmp.path, "a.ts"))
        expect(result.output).toContain(expected)
        expect(result.output).not.toContain("\\")
      },
    })
  })
})
