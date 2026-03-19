import { describe, expect, test } from "bun:test"
import path from "path"
import { GlobTool } from "../../src/tool/glob"
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

describe("tool.glob", () => {
  test("accepts Windows alias directories and returns canonical matches", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "src", "tool.ts"), "export const ok = true\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const glob = await GlobTool.init()
        for (const item of win(tmp.path)) {
          const result = await glob.execute(
            {
              pattern: "**/*.ts",
              path: item.path,
            },
            ctx,
          )

          expect(result.metadata.count).toBe(1)
          expect(result.output).toContain(path.join(tmp.path, "src", "tool.ts"))
        }
      },
    })
  })
})
