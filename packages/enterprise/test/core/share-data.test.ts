import { describe, expect, test } from "bun:test"
import { ShareData } from "../../src/core/share-data"

describe("share data", () => {
  test("parses the persisted presentation fields and preserves tool metadata", () => {
    const value = {
      type: "part" as const,
      batchField: "retained",
      data: {
        id: "prt_1",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "tool" as const,
        callID: "call_1",
        tool: "read",
        state: {
          status: "completed" as const,
          input: { path: "README.md" },
          output: "contents",
          metadata: { custom: { retained: true } },
          time: { start: 1, end: 2, providerTime: 3 },
        },
        providerField: "retained",
      },
    }

    expect(ShareData.parse(value)).toEqual(value)
  })

  test("rejects incomplete persisted messages at the boundary", () => {
    expect(() =>
      ShareData.parse({
        type: "message",
        data: { id: "msg_1", sessionID: "ses_1", role: "assistant" },
      }),
    ).toThrow()
  })

  test("accepts persisted summary diffs without a file", () => {
    expect(
      ShareData.parse({
        type: "message",
        data: {
          id: "msg_1",
          sessionID: "ses_1",
          role: "user",
          time: { created: 0 },
          summary: { diffs: [{ additions: 1, deletions: 0 }] },
        },
      }),
    ).toBeDefined()
  })
})
