import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ListTool } from "../../src/tool/ls"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.ls", () => {
  test("renders repo-key trees under a native root path", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src", "nested"), { recursive: true })
        await fs.writeFile(path.join(dir, "src", "nested", "file.ts"), "export {}\n")
        await fs.writeFile(path.join(dir, "src", "root.ts"), "export {}\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ListTool.init()
        const result = await tool.execute({ path: tmp.path }, ctx)

        expect(result.output.startsWith(`${tmp.path}${path.sep}\n`)).toBe(true)
        expect(result.output).toContain("  src/\n")
        expect(result.output).toContain("    nested/\n")
        expect(result.output).toContain("      file.ts\n")
        expect(result.output).toContain("    root.ts\n")
      },
    })
  })
})
