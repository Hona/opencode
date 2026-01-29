import { describe, expect, test } from "bun:test"
import nodePath from "node:path"
import { toPosix } from "@opencode-ai/util/path"
import { MultiEditTool } from "../../src/tool/multiedit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { FileTime } from "../../src/file/time"

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

describe("tool.multiedit path normalization", () => {
  if (!isWin) return

  test("windows: accepts MSYS-style absolute file paths", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        lsp: false,
      },
      init: async (dir) => {
        await Bun.write(nodePath.join(dir, "a.txt"), "hello")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MultiEditTool.init()

        const expected = toPosix(nodePath.join(tmp.path, "a.txt"))
        FileTime.read(ctx.sessionID, expected)

        const msysDir = toPosix(tmp.path).replace(/^([a-zA-Z]):\//, (_, d) => `/${d.toLowerCase()}/`)
        const inputPath = `${msysDir}/a.txt`

        await tool.execute(
          {
            filePath: inputPath,
            edits: [
              {
                filePath: inputPath,
                oldString: "hello",
                newString: "world",
              },
            ],
          },
          ctx,
        )

        expect(await Bun.file(expected).text()).toBe("world")
      },
    })
  })
})
