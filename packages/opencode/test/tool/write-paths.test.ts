import { describe, expect, test } from "bun:test"
import path from "path"
import { toPosix } from "@opencode-ai/util/path"
import { WriteTool } from "../../src/tool/write"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"

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

describe("tool.write path normalization", () => {
  if (!isWin) return

  test("windows: accepts MSYS-style absolute file paths", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        lsp: false,
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const write = await WriteTool.init()

        const msysDir = toPosix(tmp.path).replace(/^([a-zA-Z]):\//, (_, d) => `/${d.toLowerCase()}/`)
        const inputPath = `${msysDir}/out.txt`
        const expected = toPosix(path.join(tmp.path, "out.txt"))

        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }

        const result = await write.execute({ filePath: inputPath, content: "hi" }, testCtx)

        expect(result.metadata.filepath).toBe(expected)
        expect(result.metadata.filepath).not.toContain("\\")
        expect(await Bun.file(expected).text()).toBe("hi")

        const editReq = requests.find((r) => r.permission === "edit")
        expect(editReq).toBeDefined()
        expect(editReq!.metadata.filepath).toBe(expected)
      },
    })
  })
})
