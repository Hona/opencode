import { describe, expect, test } from "bun:test"
import { readShareDocument } from "../../src/core/share-document"
import type { Share } from "../../src/core/share"

describe("share document", () => {
  test("passes current blobs through", async () => {
    const data = [
      {
        type: "session",
        data: {
          id: "ses_current",
          projectID: "project_current",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          title: "Current share",
          location: { directory: "/workspace" },
          time: { created: 1, updated: 2 },
        },
      },
      {
        type: "messages",
        data: {
          sessionID: "ses_current",
          messages: [{ id: "msg_current", type: "user", text: "Current prompt", time: { created: 1 } }],
        },
      },
    ] satisfies Share.Data[]

    const result = await readShareDocument(data)

    expect(result.session.id).toBe("ses_current")
    expect(result.messages).toEqual([{ id: "msg_current", type: "user", text: "Current prompt", time: { created: 1 } }])
    expect(result.warnings).toEqual([])
  })

  test("maps a legacy Session without changing its blob", async () => {
    const sessionID = "ses_stored"
    const messageID = "msg_000000000001aaaaaaaaaaaaaa"
    const data = [
      {
        type: "session",
        data: {
          id: sessionID,
          slug: "stored",
          projectID: "project_stored",
          directory: "/workspace",
          title: "Stored share",
          version: "1",
          time: { created: 1, updated: 2 },
        },
      },
      {
        type: "message",
        data: {
          id: messageID,
          sessionID,
          role: "user",
          time: { created: 1 },
          agent: "build",
          model: { providerID: "provider", modelID: "model" },
        },
      },
      {
        type: "part",
        data: {
          id: "prt_000000000001aaaaaaaaaaaaaa",
          sessionID,
          messageID,
          type: "text",
          text: "Stored prompt",
        },
      },
    ] satisfies Share.Data[]
    const snapshot = structuredClone(data)

    const result = await readShareDocument(data)

    expect(data).toEqual(snapshot)
    expect(result.session).toMatchObject({ id: sessionID, location: { directory: "/workspace" } })
    expect(result.messages).toEqual([
      {
        id: messageID,
        type: "user",
        text: "Stored prompt",
        time: { created: 1 },
      },
    ])
  })
})
