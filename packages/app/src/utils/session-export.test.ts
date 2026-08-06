import { describe, expect, test } from "bun:test"
import { buildSessionExport, sessionExportFilename } from "./session-export"
import type { Message, Part, Session } from "@opencode-ai/sdk/v2/client"

describe("sessionExportFilename", () => {
  test("generates filename from title", () => {
    expect(sessionExportFilename({ id: "ses_123", title: "Clone PR in worktree from fork" })).toBe(
      "clone-pr-in-worktree-from-fork.json",
    )
  })

  test("generates filename from slug when title missing", () => {
    expect(sessionExportFilename({ id: "ses_123", slug: "my-session-slug" })).toBe("my-session-slug.json")
  })

  test("falls back to id when title and slug are empty", () => {
    expect(sessionExportFilename({ id: "ses_123" })).toBe("ses_123.json")
  })
})

describe("buildSessionExport", () => {
  test("combines session, messages, and parts", () => {
    const session = { id: "ses_1", title: "Test Session" } as Session
    const msg1 = { id: "msg_1", role: "user" } as Message
    const msg2 = { id: "msg_2", role: "assistant" } as Message
    const part1 = { id: "prt_1", type: "text", text: "hello" } as Part
    const part2 = { id: "prt_2", type: "text", text: "world" } as Part

    const result = buildSessionExport(session, [msg1, msg2], {
      msg_1: [part1],
      msg_2: [part2],
    })

    expect(result).toEqual({
      info: session,
      messages: [
        { info: msg1, parts: [part1] },
        { info: msg2, parts: [part2] },
      ],
    })
  })
})
