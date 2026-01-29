import { describe, expect, test } from "bun:test"
import path from "path"
import { toPosix } from "@opencode-ai/util/path"
import { EditTool } from "../../src/tool/edit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"
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

describe("tool.edit path normalization", () => {
  if (!isWin) return

  test("windows: accepts MSYS-style absolute file paths", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        lsp: false,
      },
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.txt"), "hello")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()

        const msysDir = toPosix(tmp.path).replace(/^([a-zA-Z]):\//, (_, d) => `/${d.toLowerCase()}/`)
        const inputPath = `${msysDir}/a.txt`
        const expected = toPosix(path.join(tmp.path, "a.txt"))

        FileTime.read(ctx.sessionID, expected)

        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }

        const result = await edit.execute(
          {
            filePath: inputPath,
            oldString: "hello",
            newString: "world",
          },
          testCtx,
        )

        expect(await Bun.file(expected).text()).toBe("world")
        expect(result.metadata.filediff.file).toBe(expected)
        expect(result.metadata.filediff.file).not.toContain("\\")

        const editReq = requests.find((r) => r.permission === "edit")
        expect(editReq).toBeDefined()
        expect(editReq!.metadata.filepath).toBe(expected)
      },
    })
  })
})
