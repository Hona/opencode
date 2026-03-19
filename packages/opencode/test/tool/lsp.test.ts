import { describe, expect, test } from "bun:test"
import path from "path"
import { LspTool } from "../../src/tool/lsp"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"
import { win } from "../lib/windows-path"

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

describe("tool.lsp", () => {
  test("accepts Windows alias file paths before LSP availability checks", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "note.txt"), "hello\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lsp = await LspTool.init()
        for (const item of win(path.join(tmp.path, "note.txt"))) {
          await expect(
            lsp.execute(
              {
                operation: "hover",
                filePath: item.path,
                line: 1,
                character: 1,
              },
              ctx,
            ),
          ).rejects.toThrow("No LSP server available")
        }
      },
    })
  })
})
